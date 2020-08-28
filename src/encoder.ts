import * as ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as cliProgress from "cli-progress";
import { Readable } from "stream";
import { Encoder } from "./types";

const typeCheck = (reject: (reason?: any) => void, config) => {
    const { frameStream, output, backgroundVideo, fps } = config;
    if (!(frameStream instanceof Readable)) {
        reject(
            new Error(`frameStream should be in type Readable. You provided ${typeof frameStream}`),
        );
    }
    if (!(typeof output === "string")) {
        reject(new Error(`output should be a string. You provided ${typeof output}`));
    }
    if (!(fps && fps.input && fps.output)) {
        reject(new Error(`fps should be an object with input and output properties`));
    }
    if (backgroundVideo) {
        if (
            !(backgroundVideo.inSeconds && backgroundVideo.outSeconds && backgroundVideo.videoPath)
        ) {
            reject(new Error("backgroundVideo property is not correctly set"));
        }
    }
};

const createDir = (reject: (reason?: any) => void, silent: boolean, output: string) => {
    try {
        const outDir = path.dirname(output);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
    } catch (e) {
        if (!silent) console.log("Could not create/access output directory");
        reject(new Error("Cannot create/access output directory"));
    }
};

const encoder: Encoder = (config) => {
    return new Promise((resolve, reject) => {
        const { frameStream, output, backgroundVideo, fps, silent = true } = config;

        typeCheck(reject, config);

        createDir(reject, silent, output);

        const outputStream = fs.createWriteStream(output);

        const command = ffmpeg();

        if (backgroundVideo) {
            command.input(backgroundVideo.videoPath);
        }

        command.input(frameStream).inputFPS(fps.input);
        command.outputOptions([
            "-preset veryfast",
            "-crf 24",
            "-f mp4",
            "-movflags frag_keyframe+empty_moov",
            "-pix_fmt yuv420p",
        ]);
        command.fps(fps.output);

        if (!!backgroundVideo) {
            command.complexFilter(
                [
                    "[1:v]setpts=PTS+" + backgroundVideo.inSeconds + "/TB[out]",
                    {
                        filter: "overlay",
                        options: {
                            enable:
                                "between(t," +
                                backgroundVideo.inSeconds +
                                "," +
                                backgroundVideo.outSeconds +
                                ")",
                            x: "0",
                            y: "0",
                        },
                        inputs: "[0:v][out]",
                        outputs: "tmp",
                    },
                ],
                "tmp",
            );
        }

        command.output(outputStream);

        const progressBar = new cliProgress.SingleBar({
            format: `Rendering | {bar} | {percentage}%`,
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
            hideCursor: true,
        });

        command.on("start", function (commandLine) {
            if (!silent) console.log("Spawned Ffmpeg with command: " + commandLine);
            if (!silent) progressBar.start(100, 0);
        });

        command.on("end", function () {
            if (!silent) {
                progressBar.stop();
                console.log("Processing complete...");
            }
            resolve({
                path: output,
                stream: outputStream,
            });
        });

        command.on("progress", function (progress) {
            if (!silent) {
                const percent = progress.percent
                    ? parseFloat((progress.percent as number).toFixed(2))
                    : 0;
                progressBar.update(percent);
            }
        });

        command.on("error", function (err: { message: string }) {
            if (!silent) console.log("An error occured while processing,", err.message);
            reject(new Error(err.message));
        });

        command.run();
    });
};

export default encoder;
