import { Transform, TransformCallback } from "stream";
import { Client, TextChannel, ActivityOptions } from "discord.js-selfbot-v13";
import ffmpeg from 'fluent-ffmpeg';
import { StreamOutput } from '@dank074/fluent-ffmpeg-multistream-ts';
import { command, streamLivestreamVideo, MediaUdp, setStreamOpts, Streamer, VideoStream, AudioStream, H264NalSplitter, H265NalSplitter, IvfTransformer, Utils } from "@dank074/discord-video-stream";
import prism from "prism-media";


import config from "./config.json";
import fs from 'fs';
import readline from 'readline';
import path from 'path';
import ytdl from '@distube/ytdl-core';
import yts from 'play-dl';
import { TiktokVideo, TiktokLive } from "./util/Tiktok";
import 'dotenv/config'

const { normalizeVideoCodec } = Utils;
const streamer = new Streamer(new Client());

const tiktokVideo = new TiktokVideo();
const tiktokLive = new TiktokLive();

require('dotenv').config()

setStreamOpts(config.streamOpts);

async function parseM3U8(filePath: string): Promise<string[]> {
    const urls: string[] = [];
    const fileStream = fs.createReadStream(filePath);

    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (line.startsWith('http') || line.startsWith('rtsp')) {
            urls.push(line.trim());
        }
    }

    return urls;
}

const prefix = config.prefix;

const videosFolder = config.videosFolder || './videos';

const videoFiles = fs.readdirSync(videosFolder);
let videos = videoFiles.map(file => {
    const fileName = path.parse(file).name;
    // replace space with _
    return { name: fileName.replace(/ /g, ''), path: path.join(videosFolder, file) };
});

// print out all videos
console.log(`Available videos:\n${videos.map(m => m.name).join('\n')}`);

const status_idle = () => {
    return {
        name: 'Watching Something!',
        type: 'WATCHING' as const
    };
};

const status_watch = (name: string) => {
    return {
        name: `Playing ${name}...`,
        type: 'WATCHING' as const
    };
};

// ready event
streamer.client.on("ready", () => {
    if (streamer.client.user) {
        console.log(`--- ${streamer.client.user.tag} is ready ---`);
        streamer.client.user.setActivity(status_idle() as ActivityOptions);
    }
});

let streamStatus = {
    joined: false,
    joinsucc: false,
    playing: false,
    channelInfo: {
        guildId: '',
        channelId: '',
        cmdChannelId: ''
    },
    starttime: "00:00:00",
    timemark: '',
}

streamer.client.on('voiceStateUpdate', (oldState, newState) => {
    // when exit channel
    if (oldState.member?.user.id == streamer.client.user?.id) {
        if (oldState.channelId && !newState.channelId) {
            streamStatus.joined = false;
            streamStatus.joinsucc = false;
            streamStatus.playing = false;
            streamStatus.channelInfo = {
                guildId: '',
                channelId: '',
                cmdChannelId: streamStatus.channelInfo.cmdChannelId
            }
            streamer.client.user?.setActivity(status_idle() as ActivityOptions);
        }
    }
    // when join channel success
    if (newState.member?.user.id == streamer.client.user?.id) {
        if (newState.channelId && !oldState.channelId) {
            streamStatus.joined = true;
            if (newState.guild.id == streamStatus.channelInfo.guildId && newState.channelId == streamStatus.channelInfo.channelId) {
                streamStatus.joinsucc = true;
            }
        }
    }
})

streamer.client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // ignore bots
    if (message.author.id == streamer.client.user?.id) return; // ignore self
    if (!`${process.env.COMMAND_CHANNEL}`.includes(message.channel.id)) return; // ignore non-command channels
    if (!message.content.startsWith(prefix)) return; // ignore non-commands
    
    const args = message.content.slice(prefix.length).trim().split(/ +/); // split command and arguments
    if (args.length == 0) return;

    const user_cmd = args.shift()!.toLowerCase();
    const [guildId, channelId] = [`${process.env.GUILD_ID}`, `${process.env.VIDEO_CHANNEL}`];

    if (`${process.env.COMMAND_CHANNEL}`.includes(message.channel.id)) {
        switch (user_cmd) {
            case 'play':
                if (streamStatus.joined) {
                    message.reply('Already joined');
                    return;
                }
                
                // get video name and find video file
                let videoname = args.shift();
                let video = videos.find(m => m.name == videoname);
                
                if (!video) {
                    message.reply('video not found');
                    return;
                }
                
                // get start time from args "hh:mm:ss"
                let startTime = args.shift() || '';
                let options = {}
                // check if start time is valid
                // Validate start time format
                const startTimeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/; 

                if (startTime && !startTimeRegex.test(startTime)) {
                    message.reply('Invalid start time format');
                    return;
                }

                // Split and parse start time  
                const startTimeParts = startTime!.split(':');
                
                let hours = 0; 
                let minutes = 0;
                let seconds = 0;

                if (startTimeParts.length === 3) {
                    hours = parseInt(startTimeParts[0], 10);
                    minutes = parseInt(startTimeParts[1], 10); 
                    seconds = parseInt(startTimeParts[2], 10);
                }

                if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
                    message.reply('Invalid start time');
                    return;
                }

                // Calculate total seconds
                const startTimeSeconds = hours * 3600 + minutes * 60 + seconds; 

                options['-ss'] = startTimeSeconds;

                await streamer.joinVoice(guildId, channelId);
                streamStatus.joined = true;
                streamStatus.playing = false;
                streamStatus.starttime = startTime;
                streamStatus.channelInfo = {
                    guildId: guildId,
                    channelId: channelId,
                    cmdChannelId: message.channel.id
                }
                const streamUdpConn = await streamer.createStream();
                playVideo(video.path, streamUdpConn, options);
                message.reply('Playing ( `' + videoname + '` )...');
                console.log(message.reply('Playing ( `' + videoname + '` )...'));
                streamer.client.user?.setActivity(status_watch(videoname) as ActivityOptions);
                break;
            case 'playlink':
                if (streamStatus.joined) {
                    message.reply('**Already joined**');
                    return;
                }
                
                let link = args.shift() || '';
                
                if (!link) {
                    message.reply('**Please provide a direct link/Youtube Link.**')
                    return;
                }
                
                let linkstartTime = args.shift() || '';
                let linkOptions = {}
                
                await streamer.joinVoice(guildId, channelId);
            
                streamStatus.joined = true;
                streamStatus.playing = false;
                streamStatus.starttime = linkstartTime;
                streamStatus.channelInfo = {
                    guildId: guildId,
                    channelId: channelId,
                    cmdChannelId: message.channel.id
                }
                
                const streamLinkUdpConn = await streamer.createStream();
            
                switch (true) {
                    case validateTiktokVideoURL(link):
                        try {
                            const videoUrl = await tiktokVideo.getVideo(link);
                            if (videoUrl) {  
                                playVideo(videoUrl, streamLinkUdpConn, linkOptions);
                                message.reply('**Playing...**');
                                streamer.client.user?.setActivity(status_watch("") as ActivityOptions);
                            }
                        } catch (error) {
                            message.reply('An error occurred!');
                        }
                        break;
                
                    case validateTiktokLiveURL(link):
                        try {
                            const liveUrl = await fetchTiktokUrl(link);
                            if (liveUrl) {
                                playVideo(liveUrl, streamLinkUdpConn, linkOptions);
                                message.reply('**Playing ' + tiktokLive.user + '\'s live **');
                                streamer.client.user?.setActivity(status_watch("") as ActivityOptions);
                            }
                        } catch (error) {
                            message.reply('An error occurred!');
                        }
                        break;
                    case ytdl.validateURL(link):
                        const yturl = await getVideoUrl(link).catch(error => {
                            console.error("Error:", error);
                        });
                        if (yturl) {
                            message.reply('**Playing...**');
                            playVideo(yturl, streamLinkUdpConn, linkOptions);
                            streamer.client.user?.setActivity(status_watch("") as ActivityOptions);
                        }
                        break;
                    default:
                        playVideo(link, streamLinkUdpConn, linkOptions);
                        message.reply('Playing...');
                        streamer.client.user?.setActivity(status_watch("") as ActivityOptions);
                }                    
            
            break; 
            case 'ytplay':
                if (streamStatus.joined) {
                    message.reply('**Already joined**');
                    return;
                }
                
                let title = args.length > 1 ? args.slice(1).join(' ') : args[1] || args.shift() || '';
                
                if (!title) {
                    message.reply('**Please provide a Youtube title!**')
                    return;
                }
                
                let titlestartTime = args.shift() || '';
                let titleOptions = {}
                
                await streamer.joinVoice(guildId, channelId);
            
                streamStatus.joined = true;
                streamStatus.playing = false;
                streamStatus.starttime = titlestartTime;
                streamStatus.channelInfo = {
                    guildId: guildId,
                    channelId: channelId,
                    cmdChannelId: message.channel.id
                }
                
                const streamYoutubeTitleUdpConn = await streamer.createStream();
                const ytUrlFromTitle = await ytPlayTitle(title);
                if(ytUrlFromTitle) {
                    message.reply('**Playing...**');
                    playVideo(ytUrlFromTitle, streamYoutubeTitleUdpConn, titleOptions);
                    streamer.client.user?.setActivity(status_watch("") as ActivityOptions);    
                }

                break;  
            case 'ytsearch':                  
                let query = args.length > 1 ? args.slice(1).join(' ') : args[1] || args.shift() || '';
                
                if (!query) {
                    message.reply('**Please provide a Youtube title!**')
                    return;
                }
                
                const ytSearchQuery = await ytSearch(query);
                try {
                    if(ytSearchQuery) {
                        message.reply(ytSearchQuery.join('\n'));
                    }

                } catch(error) {
                    message.reply("Error");
                }

                break;               
            case 'stop':
                if(!streamStatus.joined) {
                    message.reply('**Already Stopped!**');
                    return;
                }
                streamer.leaveVoice()
                streamStatus.joined = false;
                streamStatus.joinsucc = false;
                streamStatus.playing = false;
                streamStatus.channelInfo = {
                    guildId: '',
                    channelId: '',
                    cmdChannelId: streamStatus.channelInfo.cmdChannelId
                }
                // use sigkill??
                command?.kill("SIGKILL");
                console.log("Stopped playing")
                message.reply('**Stopped playing.**');
                break;  
            case 'playtime': //        not working correctly for now
                let start = streamStatus.starttime.split(':');
                let mark = streamStatus.timemark.split(':');
                let h = parseInt(start[0]) + parseInt(mark[0]);
                let m = parseInt(start[1]) + parseInt(mark[1]);
                let s = parseInt(start[2]) + parseInt(mark[2]);
                if (s >= 60) {
                    m += 1;
                    s -= 60;
                }
                if (m >= 60) {
                    h += 1;
                    m -= 60;
                }
                message.reply(`Play time: ${h}:${m}:${s}`);
                break;               
            case 'pause':
                if (!streamStatus.playing) {
                    command?.kill("SIGSTOP");
                    message.reply('Paused');
                    streamStatus.playing = false;
                } else {
                    message.reply('Not playing');
                }
                break;
            case 'resume':
                if (!streamStatus.playing) {
                    command?.kill("SIGCONT");
                    message.reply('Resumed');
                    streamStatus.playing = true;
                } else {
                    message.reply('Not playing');
                }
                break;
            case 'list':
                message.reply(`Available videos:\n${videos.map(m => m.name).join('\n')}`);
                break;
            case 'status':
                message.reply(`Joined: ${streamStatus.joined}\nPlaying: ${streamStatus.playing}`);
                break;
            case 'refresh':
                // refresh video list
                const videoFiles = fs.readdirSync(videosFolder);
                videos = videoFiles.map(file => {
                    const fileName = path.parse(file).name;
                    // replace space with _
                    return { name: fileName.replace(/ /g, ''), path: path.join(videosFolder, file) };
                });
                message.reply('video list refreshed ' + videos.length + ' videos found.\n' + videos.map(m => m.name).join('\n'));
                break;
            case 'help':
                const commands = {
                    play: {
                        description: 'Play a video',
                        usage: 'play [video name]',
                    },

                    playlink: {
                        description: 'Play a video/video/stream direct link or from youtube/tiktok link',
                        usage: 'playlink [link]',
                    },

                    ytplay: {
                        description: 'Play a YouTube video from a title query',
                        usage: 'ytplay [query]',
                    },

                    ytsearch: {
                        description: 'Search for a YouTube video using a title query',
                        usage: 'ytsearch [query]',
                    },

                    stop: {
                        description: 'Stop the current playing video',
                        usage: 'stop'
                    },  
                    
                    pause: {
                        description: 'Pause the currently playing video',
                        usage: 'pause'
                    },
                    
                    resume: {
                        description: 'Resume the paused video',
                        usage: 'resume'
                    },

                    list: {
                        description: 'Get available video list',
                        usage: 'list'
                    },

                    refresh: {
                        description: 'Refresh video list.',
                        usage: 'refresh'
                    },

                    status: {
                        description: 'Get bot status.',
                        usage: 'status'
                    },
                
                    help: {
                        description: 'Show this help message',
                        usage: 'help' 
                    }
                }
                
                let help = 'Available commands:\n\n';

                for (const [name, cmd] of Object.entries(commands)) {
                    help += `**${name}: ${cmd.description}**\n`;
                    help += `Usage: \`${prefix}${cmd.usage}\`\n`;                                   
                    
                }
                                
                // reply all commands here
                message.reply(help);
                break;
            default:
                message.reply('**Invalid command**');
        }
    }
});

streamer.client.login(`${process.env.DISCORD_USER_TOKEN}`);

let lastPrint = "";

async function playVideo(videoUrl: string, udpConn: MediaUdp, options: any) {
    console.log("Starting the video playback...");

    // Log the video URL and options to ensure they are correct
    console.log(`Video URL: ${videoUrl}`);
    console.log(`Options: ${JSON.stringify(options)}`);

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);

    try {
        if (isIPTVUrl(videoUrl)) {
            console.log("Detected IPTV stream, handling it separately...");
            await streamIPTV(videoUrl, udpConn, options);
        } else {
            console.log("Handling as a regular video stream...");
            await streamLivestreamVideo(videoUrl, udpConn, true, options);
        }

        console.log("Video stream should now be playing.");
    } catch (error) {
        console.error("Error occurred while trying to play the video:", error);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
        command?.kill("SIGKILL");
        sendFinishMessage();
        cleanupStreamStatus();
    }
}

function isIPTVUrl(url: string): boolean {
    // Check if the URL seems to be an IPTV stream
    return url.includes('.m3u8') || url.startsWith('rtsp://') || url.includes('iptv');
}

async function streamIPTV(videoUrl: string, udpConn: MediaUdp | any, options: any) {
    console.log("Streaming IPTV content...");
    const PCancelable = await import('p-cancelable');
    return new PCancelable<void>((resolve, reject, onCancel) => {
        try {
            const ffmpegCommand = ffmpeg(videoUrl)
                .addOption('-loglevel', 'verbose')
                .on('start', () => {
                    console.log('FFmpeg process started for IPTV stream.');
                })
                .on('end', () => {
                    console.log('IPTV stream ended.');
                    resolve();
                })
                .on('error', (err: any) => {
                    console.error('Error during IPTV streaming:', err);
                    reject(err);
                });

            const streamOpts = udpConn.mediaConnection.streamOptions;
            const videoStream = new VideoStream(udpConn, streamOpts.fps, streamOpts.readAtNativeFps);
            const videoCodec = normalizeVideoCodec(streamOpts.videoCodec);
            let videoOutput: Transform;

            switch (videoCodec) {
                case 'H264':
                    videoOutput = new H264NalSplitter();
                    break;
                case 'H265':
                    videoOutput = new H265NalSplitter();
                    break;
                case "VP8":
                    videoOutput = new IvfTransformer();
                    break;
                default:
                    throw new Error("Codec not supported");
            }

            ffmpegCommand.output(StreamOutput(videoOutput).url, { end: false })
                .noAudio()
                .size(`${streamOpts.width}x${streamOpts.height}`)
                .fpsOutput(streamOpts.fps)
                .videoBitrate(`${streamOpts.bitrateKbps}k`)
                .format(videoCodec === 'VP8' ? 'ivf' : 'h264')
                .outputOptions(videoCodec === 'H265' ? [
                    '-tune zerolatency',
                    '-pix_fmt yuv420p',
                    `-preset ${streamOpts.h26xPreset}`,
                    '-profile:v main',
                    `-g ${streamOpts.fps}`,
                    `-bf 0`,
                    `-x265-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                    '-bsf:v hevc_metadata=aud=insert'
                ] : [
                    '-tune zerolatency',
                    '-pix_fmt yuv420p',
                    `-preset ${streamOpts.h26xPreset}`,
                    '-profile:v baseline',
                    `-g ${streamOpts.fps}`,
                    `-bf 0`,
                    `-x264-params keyint=${streamOpts.fps}:min-keyint=${streamOpts.fps}`,
                    '-bsf:v h264_metadata=aud=insert'
                ]);

            videoOutput.pipe(videoStream, { end: false });

            if (options.includeAudio) {
                const audioStream: AudioStream = new AudioStream(udpConn);
                const opus = new prism.opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 });

                ffmpegCommand.output(StreamOutput(opus).url, { end: false })
                    .noVideo()
                    .audioChannels(2)
                    .audioFrequency(48000)
                    .format('s16le');

                opus.pipe(audioStream, { end: false });
            }

            ffmpegCommand.run();
            onCancel(() => {
                console.log("Cancelling the IPTV stream...");
                ffmpegCommand.kill("SIGINT");
            });
        } catch (error) {
            console.error('Failed to stream IPTV content:', error);
            reject(error);
        }
    });
}

function handleProgress(msg: any) {
    if (shouldPrintTimemark(msg.timemark)) {
        console.log(`Timemark: ${msg.timemark}`);
        lastPrint = msg.timemark;
    }

    streamStatus.timemark = msg.timemark;
}

function shouldPrintTimemark(timemark: string): boolean {
    if (!streamStatus.timemark) {
        return true;
    }

    const last = parseTimemark(lastPrint);
    const now = parseTimemark(timemark);

    const lastSeconds = timeToSeconds(last);
    const nowSeconds = timeToSeconds(now);

    return nowSeconds - lastSeconds >= 10;
}

function parseTimemark(timemark: string): number[] {
    return timemark.split(':').map(Number);
}

function timeToSeconds(time: number[]): number {
    return time[2] + time[1] * 60 + time[0] * 3600;
}

function sendFinishMessage() {
    const channel = streamer.client.channels.cache.get(streamStatus.channelInfo.cmdChannelId) as TextChannel;
    channel?.send('**Finished playing video.**');
}

function cleanupStreamStatus() {
    streamer.leaveVoice();
    streamer.client.user?.setActivity(status_idle() as ActivityOptions);

    streamStatus.joined = false;
    streamStatus.joinsucc = false;
    streamStatus.playing = false;
    lastPrint = "";

    streamStatus.channelInfo = {
        guildId: '',
        channelId: '',
        cmdChannelId: ''
    };
}

async function getVideoUrl(videoUrl: string) {
    const video = await ytdl.getInfo(videoUrl);
    const videoDetails = video.videoDetails;
    if (videoDetails.isLiveContent) {
        // check if the video url is livestream
        const tsFormats = video.formats.filter(format => format.container === 'ts');
        const highestTsFormat = tsFormats.reduce((prev: any, current: any) => {
            if (!prev || current.bitrate > prev.bitrate) {
                return current;
            }
            return prev;
        });

        if (highestTsFormat) {
            return highestTsFormat.url;
        }
    } else {
        const videoFormats = video.formats
            .filter((format: { hasVideo: any; hasAudio: any; }) => format.hasVideo && format.hasAudio)
            .filter(format => format.container === 'mp4');

        return videoFormats[0].url;
    }
}

async function ytPlayTitle(title: string) {
    try {
        const r = await yts.search(title, { limit: 1 });
        
        if (r.length > 0) {
            const video = r[0];
            const videoId = video.id;
            if(videoId) {
                const ytvideo = await ytdl.getInfo(videoId);
                const videoFormats = ytvideo.formats
                    .filter((format: { hasVideo: any; hasAudio: any; }) => format.hasVideo && format.hasAudio)
                    .filter(format => format.container === 'mp4');
                return videoFormats[0].url;
            }
        }             
    } catch(error) {
        console.log('No videos found with the given title.');
    }
}

async function ytSearch(title: string): Promise<string[]> {
    try {
        const r = await yts.search(title, { limit: 5 });
        const searchResults: string[] = [];
        if (r.length > 0) {
            r.forEach(function(video: any, index: number) { // Corrected forEach loop
                const result = `${index + 1}. \`${video.title}\``;
                searchResults.push(result);
            });
        }
        return searchResults;
    } catch(error) {
        console.log('No videos found with the given title.');
        return [];
    }
}

async function fetchTiktokUrl(url: string) {
    try {
        // Set the TikTok URL you want to fetch information from
        tiktokLive.url = url;

        // Fetch the room and user information from the TikTok URL
        const [user, roomId] = await tiktokLive.getRoomAndUserFromUrl();
        // Fetch the live stream URL
        const liveUrl = await tiktokLive.getLiveUrl();

        return liveUrl;
        //console.log(`Live Stream URL: ${liveUrl}`); // this was for debugging
    } catch (error) {
        //console.error('An error occurred!); // this was for debugging
    }
}

function validateTiktokLiveURL(url: string) {
    const tiktokLiveUrlRegex = /https:\/\/(www\.)?tiktok\.com\/@([^/]+)\/live/i;
    return tiktokLiveUrlRegex.test(url);
}

function validateTiktokVideoURL(url: string) {
    const tiktokVideoUrlRegex = /https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\/\d+/i;
    return tiktokVideoUrlRegex.test(url);
}

// run server if enabled in config
if (config.server.enabled) {
    // run server.js
    require('./server');
}
