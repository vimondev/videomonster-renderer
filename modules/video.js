const fs = require(`fs`)
const config = require(`../config`)
const {
    aerenderPath,
    ffmpegPath
} = config
const fsAsync = require('./fsAsync')
const { retry, retryBoolean, TaskKill } = require('../global')

function AccessAsync(path) {
    return new Promise((resolve, reject) => {
        fs.access(path, err => {
            if (err) resolve(false)
            else resolve(true)
        })
    })
}

function ReadDirAsync(path) {
    return new Promise((resolve, reject) => {
        fs.readdir(path, (err, files) => {
            if (err) reject(err)
            else resolve(files)
        })
    })
}

function UnlinkAsync(path) {
    return new Promise((resolve, reject) => {
        fs.unlink(path, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}

function MkdirAsync(path) {
    return new Promise((resolve, reject) => {
        fs.mkdir(path, err => {
            if(err) reject(err)
            else resolve()
        })
    })
}

function RenameAsync(oldPath, newPath) {
    return new Promise((resolve, reject) => {
        fs.rename(oldPath, newPath, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}

function WriteFileAsync(path, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 렌더링 진행률 보고를 위한 변수
let totalRenderedFrameCount = 0     // aerender 프로세스로 렌더링 된 프레임 개수
let totalConvertedFrameCount = 0    // ffmpeg 프로세스로 h264로 인코딩된 프레임 개수

// 초기화
exports.ResetTotalRenderedFrameCount = () => {
    totalRenderedFrameCount = 0
    totalConvertedFrameCount = 0
}

exports.GetTotalRenderedFrameCount = () => {
    return (totalRenderedFrameCount + totalConvertedFrameCount) / 2
}

// 오디오 렌더링
exports.AudioRender = (aepPath, audioPath, totalFrameCount) => {
    return new Promise((resolve, reject) => {
        try {
            let isAudioRendering = true

            const CheckProcessStuck = async () => {
                const startTime = Date.now()
                while (isAudioRendering) {
                    if (Date.now() - startTime >= 1000 * 60 * 3) {
                        TaskKill('aerender.exe')
                        break
                    }
                    await sleep(1000)
                }
            }
            CheckProcessStuck()

            console.log(`Audio Render Start!`)

            // 오디오 렌더링을 수행한다. (분산 렌더링 없이 처음부터 끝까지)
            const spawn = require(`child_process`).spawn,

                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `0`, `-e`, `${Number(totalFrameCount) - 1}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"AIFF 48kHz"`, `-output`, `"${audioPath}"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                isAudioRendering = false
                console.log('child process exited with code ' + code)
                try {
                    await sleep(1000)

                    // 출력된 AIF 파일이 있는지 검사
                    if (!(await retryBoolean(AccessAsync(`${audioPath}`)))) {
                        return reject(`ERR_AUDIO_FILE_NOT_EXIST (오디오 렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_AUDIO_RENDER_FAILED (오디오 렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_AUDIO_RENDER_FAILED (오디오 렌더링 실패)`)
        }
    })
}

// 비디오 렌더링
exports.VideoRender = (rendererIndex, videoPath, aepPath, startFrame, endFrame, hashTagString) => {
    return new Promise(async (resolve, reject) => {
        try {
            const homeDir = `${require('os').homedir()}/AppData`
            if (await fsAsync.AccessAsyncBoolean(`${homeDir}/Local/Temp`)) await fsAsync.UnlinkFolderRecursiveIgnoreError(`${homeDir}/Local/Temp`)
            if (await fsAsync.AccessAsyncBoolean(`${homeDir}/Roaming/Adobe`)) await fsAsync.UnlinkFolderRecursiveIgnoreError(`${homeDir}/Roaming/Adobe`)

            const frameDuration = {}
            let nowTime = Date.now()

            console.log(`Video Render Start!`)
            // 시작 전에 반드시 videoPath 청소
            if (await AccessAsync(videoPath)) {
                if (await AccessAsync(`${videoPath}/${rendererIndex}`)) {
                    let files = await retry(ReadDirAsync(`${videoPath}/${rendererIndex}`))
                    for (let i = 0; i < files.length; i++) {
                        // 기존 팡닐들 모두 삭제
                        await retry(UnlinkAsync(`${videoPath}/${rendererIndex}/${files[i]}`))
                    }
                }
                // 기존에 생성된 폴더가 없을 경우 생성
                else
                    await retry(MkdirAsync(`${videoPath}/${rendererIndex}`))
            }

            // startFrame ~ endFrame까지 부분 렌더링 (TIFF로 뽑아낸다.)
            // const spawn = require(`child_process`).spawn,
            //     ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"TIFF Sequence with Alpha"`, `-output`, `"${videoPath}/${rendererIndex}/frames[${hashTagString}].tif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            // startFrame ~ endFrame까지 부분 렌더링 (AVI로 뽑아낸다.)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"Lossless"`, `-output`, `"${videoPath}/${rendererIndex}/out.avi"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            // 프로세스 수행 중 print 이벤트 발생 시 콜백
            ls.stdout.on('data', function (data) {
                data = String(data)
                console.log('stdout: ' + data)

                // PROGRESS: (frameIndex) 로 출력되는 결과에서 frameIndex 값을 가져온다.
                if (data.includes(`PROGRESS:`) && data.includes(`(`) && data.includes(`)`)) {
                    const startIndex = data.indexOf(`(`) + 1
                    const endIndex = data.indexOf(`)`)

                    // 각 frame 렌더링에 걸린 시간을 계산하여 frameDuration에 저장한다.
                    const frame = data.substring(startIndex, endIndex)
                    if(!isNaN(Number(frame))) {
                        totalRenderedFrameCount = Number(frame)

                        const remainMs = Date.now() - nowTime
                        if (frameDuration.hasOwnProperty(frame)) {
                            frameDuration[frame] += remainMs
                        }
                        else frameDuration[frame] = remainMs
                    }
                }
                nowTime = Date.now()
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    // 끝났을 때는 그냥 이렇게 정확히 계산해줌.
                    totalRenderedFrameCount = Number(endFrame) - Number(startFrame) + 1

                    await sleep(1000)
                    // let files = (await retry(ReadDirAsync(`${videoPath}/${rendererIndex}`))).sort()

                    // // 각 TIFF 파일을 Rename해준다. (ffmpeg 돌리려면 프레임 숫자가 0부터 시작해야함.)
                    // for (let i=0; i<files.length; i++) {
                    //     let digit = ``
                    //     while (digit.length < hashTagString.length - String(i).length) digit += `0`
                    //     digit += i

                    //     let filename = `frames${digit}.tif`
                    //     await retry(RenameAsync(`${videoPath}/${rendererIndex}/${files[i]}`, `${videoPath}/${rendererIndex}/${filename}`))
                    // }
                }
                catch (e) {
                    console.log(e)
                    // return reject(`ERR_RENAME_FILE_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                }
                return resolve(frameDuration)
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_VIDEO_RENDER_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
        }
    })
}

// TIFF -> h264 인코딩
exports.MakeMP4 = (rendererIndex, videoPath, hashTagString, frameRate) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`MakeMP4 Start!`)

            // let digit = ``
            // while(digit.length < 3 - String(hashTagString.length).length) digit += `0`
            // digit += hashTagString.length

            // h264 인코딩을 수행한다.
            // const spawn = require(`child_process`).spawn,
            //     ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-framerate`, `${frameRate}`, `-i`, `${videoPath}/${rendererIndex}/frames%${digit}d.tif`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })
            
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}/${rendererIndex}/out.avi`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })

            // 프로세스 수행 중 print 이벤트 발생 시 콜백
            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)

                // totalConvertedFrameCount에 인코딩된 프레임 개수를 저장시켜준다.
                const str = String(data)
                if (str.includes(`frame=`) && str.includes(`fps`)) {
                    const startIndex = str.indexOf(`frame=`, 0) + 6
                    const endIndex = str.indexOf(`fps`)

                    totalConvertedFrameCount = Number(str.substring(startIndex, endIndex))
                }
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    await sleep(1000)

                    // 렌더링이 완료된 후 TIFF or AVI 파일 제거
                    let files = await retry(ReadDirAsync(`${videoPath}/${rendererIndex}`))
                    for (let i = 0; i < files.length; i++) {
                        files[i] = files[i].toLowerCase()
                        if (await AccessAsync(`${videoPath}/${rendererIndex}/${files[i]}`)) {
                            try {
                                await retry(UnlinkAsync(`${videoPath}/${rendererIndex}/${files[i]}`))
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/out${rendererIndex}.mp4`)))) {
                        return reject(`ERR_MP4_NOT_EXIST (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_MAKE_MP4_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_MAKE_MP4_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
        }
    })
}

// Merge
exports.Merge = (rendererCount, videoPath) => {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`Merge Start!`)

            // merge 정보 txt 파일을 생성해준다.
            let fileBody = ``
            for (let i = 0; i < rendererCount; i++) {
                fileBody += `file out${i}.mp4\n`
            }

            await retry(WriteFileAsync(`${videoPath}/file.txt`, fileBody))

            // merge를 수행한다.
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-f`, `concat`, `-safe`, `0`, `-i`, `${videoPath}/file.txt`, `-c`, `copy`, `${videoPath}/merge.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    await sleep(1000)

                    // 필요없는 파일들을 제거해준다.
                    let files = await retry(ReadDirAsync(`${videoPath}`))
                    for (let i = 0; i < files.length; i++) {
                        files[i] = files[i].toLowerCase()
                        if ((files[i].includes(`out`, 0) && files[i].includes(`.mp4`, 0) || files[i] == `file.txt`) && await AccessAsync(`${videoPath}/${files[i]}`)) {
                            try {
                                await retry(UnlinkAsync(`${videoPath}/${files[i]}`))
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/merge.mp4`)))) {
                        return reject(`ERR_MERGE_FILE_NOT_EXIST (렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_MERGE_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_MERGE_FAILED (렌더링 실패)`)
        }
    })
}

// 오디오 파일을 AAC 포맷으로 인코딩하는 작업
exports.AudioEncoding = (oldAudioPath, newAudioPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Audio Encoding Start!`)

            // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`,
                    [
                        `/c`, `ffmpeg`,
                        `-i`, `${oldAudioPath}`,
                        `-c:a`, `aac`,
                        `-b:a`, `256k`,
                        `-map`, `0:a:0`,
                        `${newAudioPath}`, `-y`
                    ]
                    , { cwd: ffmpegPath })


            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process(AudioEncoding) exited with code ' + code)

                try {
                    await sleep(1000)

                    // 출력된 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(newAudioPath)))) {
                        return reject(`ERR_AUDIO_ENCODING_FAILED (렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_AUDIO_ENCODING_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_AUDIO_ENCODING_FAILED (렌더링 실패)`)
        }
    })
}

async function ApplyVolume(inputAudioPath, outputAudioPath, volume) {
    return new Promise((resolve, reject) => {
        // 오디오 페이드 인
        console.log(`Audio Apply Volume Start! >> INPUT(${inputAudioPath}) OUTPUT(${outputAudioPath}) VOLUME(${volume})`)

        // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
        const spawn = require(`child_process`).spawn,
            ls = spawn(`cmd`,
                [
                    `/c`, `ffmpeg`, `-i`, `${inputAudioPath}`,
                    `-af`, `volume=${volume}`, `${outputAudioPath}`
                ]
                , { cwd: ffmpegPath })

        ls.stdout.on('data', function (data) { console.log('stdout: ' + data) })
        ls.stderr.on('data', function (data) { console.log('stderr: ' + data) })
        ls.on('exit', async function (code) {
            console.log('child process(FadeInProc) exited with code ' + code)

            try {
                await sleep(1000)

                // 출력된 mp4 파일이 존재하지 않으면 실패
                if (!(await retryBoolean(AccessAsync(outputAudioPath)))) {
                    return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            }
            catch (e) {
                console.log(e)
                reject(`ERR_APPLY_FADE_IN_AUDIO_FAILED (렌더링 실패 )` + e)
            }
        })
    })
}

async function FadeInProc(inputAudioPath, outputAudioPath, startTime, fadeDuration) {
    return new Promise((resolve, reject) => {
        // 오디오 페이드 인
        console.log(`Audio Apply FadeIn Start! >> INPUT(${inputAudioPath}) OUTPUT(${outputAudioPath}) ST(${startTime}) FD(${fadeDuration})`)

        // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
        const spawn = require(`child_process`).spawn,
            ls = spawn(`cmd`,
                [
                    `/c`, `ffmpeg`, `-i`, `${inputAudioPath}`,
                    `-af`, `afade=t=in:st=${startTime}:d=${fadeDuration}`, `${outputAudioPath}`
                ]
                , { cwd: ffmpegPath })

        ls.stdout.on('data', function (data) { console.log('stdout: ' + data) })
        ls.stderr.on('data', function (data) { console.log('stderr: ' + data) })
        ls.on('exit', async function (code) {
            console.log('child process(FadeInProc) exited with code ' + code)

            try {
                await sleep(1000)

                // 출력된 mp4 파일이 존재하지 않으면 실패
                if (!(await retryBoolean(AccessAsync(outputAudioPath)))) {
                    return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            }
            catch (e) {
                console.log(e)
                reject(`ERR_APPLY_FADE_IN_AUDIO_FAILED (렌더링 실패 )` + e)
            }
        })
    })
}

async function FadeOutProc(inputAudioPath, outputAudioPath, startTime, fadeDuration, videoDuration) {
    return new Promise((resolve, reject) => {
        // 오디오 페이드 아웃
        console.log(`Audio Apply FadeOut Start! >> INPUT(${inputAudioPath}) OUTPUT(${outputAudioPath}) ST(${startTime}) FD(${fadeDuration}) VD(${videoDuration})`)

        let fadeOutStartTime = Number(startTime) + Number(videoDuration) - Number(fadeDuration)
        if(isNaN(fadeOutStartTime)) fadeOutStartTime = 0

        // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
        const spawn = require(`child_process`).spawn,
            ls = spawn(`cmd`,
                [
                    `/c`, `ffmpeg`, `-i`, `${inputAudioPath}`,
                    `-af`, `afade=t=out:st=${fadeOutStartTime}:d=${fadeDuration}`, `${outputAudioPath}`
                ]
                , { cwd: ffmpegPath })

        ls.stdout.on('data', function (data) { console.log('stdout: ' + data) })
        ls.stderr.on('data', function (data) { console.log('stderr: ' + data) })
        ls.on('exit', async function (code) {
            console.log('child process(FadeOutProc) exited with code ' + code)
            try {
                await sleep(1000)

                // 출력된 mp4 파일이 존재하지 않으면 실패
                if (!(await retryBoolean(AccessAsync(outputAudioPath)))) {
                    return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            }
            catch (e) {
                console.log(e)
                reject(`ERR_APPLY_FADE_OUT_AUDIO_FAILED (렌더링 실패 )` + e)
            }
        })
    })
}    

// Audio Fade In/Out 효과 적용
exports.AudioFadeInOut = (audioPath, startTime, fadeDuration, videoDuration, volume) => {
    return new Promise(async (resolve, reject) => {

        const localAudioPath = `${videoPath}/music`
        const volumeAppliedOutputPath = `${localAudioPath}/volume_applied.m4a`
        const fadeInAudioOutputPath = `${localAudioPath}/audio_in.m4a`
        const fadeOutAudioOutputPath = `${localAudioPath}/audio_in_out.m4a`

        try {
            // 시작 전에 반드시 videoPath 청소
            if (await AccessAsync(`${localAudioPath}`)) {
                let files = await retry(ReadDirAsync(`${localAudioPath}`))
                for (let i = 0; i < files.length; i++) {
                    // 기존 파일들 모두 삭제
                    await retry(UnlinkAsync(`${localAudioPath}/${files[i]}`))
                }
            }
            // 기존에 생성된 폴더가 없을 경우 생성
            else
                await retry(MkdirAsync(`${localAudioPath}`))

            let currentAudioFilePath
            if (!isNaN(Number(volume)) && Number(volume) !== 1) {
                await ApplyVolume(audioPath, volumeAppliedOutputPath, volume)
                currentAudioFilePath = volumeAppliedOutputPath
            }
            else currentAudioFilePath = audioPath

            await FadeInProc(currentAudioFilePath, fadeInAudioOutputPath, startTime, fadeDuration)
            await FadeOutProc(fadeInAudioOutputPath, fadeOutAudioOutputPath, startTime, fadeDuration, videoDuration)

            resolve(fadeOutAudioOutputPath)
        }
        catch (e) {
            console.log(e)
            reject(`ERR_CONCAT_AUDIO_FAILED (렌더링 실패)`)
        }
    })
}

// 오디오 파일을 영상에 입히는 작업
exports.ConcatAudio = (videoPath, audioPath, length, videoStartTime = `00:00:00.000`, audioStartTime = `00:00:00.000`) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Concat Audio Start! Length(${length}) VST(${videoStartTime}) AST(${audioStartTime})`)

            // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`,
                    [
                        `/c`, `ffmpeg`,
                        `-ss`, `${videoStartTime}`,
                        `-t`, `${length}`,
                        `-i`, `${videoPath}/merge.mp4`,
                        `-ss`, `${audioStartTime}`,
                        `-t`, `${length}`,
                        `-i`, `${audioPath}`,
                        `-c:v`, `copy`,
                        `-c:a`, `aac`,
                        `-b:a`, `256k`,
                        `-map`, `0:v:0`,
                        `-map`, `1:a:0`,
                        `${videoPath}/result.mp4`, `-y`
                    ]
                    , { cwd: ffmpegPath })


            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process(ConcatAudio) exited with code ' + code)

                try {
                    await sleep(1000)

                    // 필요없는 파일을 제거해준다.
                    let files = await retry(ReadDirAsync(`${videoPath}`))
                    for (let i = 0; i < files.length; i++) {
                        files[i] = files[i].toLowerCase()
                        if (files[i] == `merge.mp4` && await AccessAsync(`${videoPath}/${files[i]}`)) {
                            try {
                                await retry(UnlinkAsync(`${videoPath}/${files[i]}`))
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/result.mp4`)))) {
                        return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_CONCAT_AUDIO_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_CONCAT_AUDIO_FAILED (렌더링 실패)`)
        }
    })
}

// 다른 오디오 파일을 영상에 추가로 입히는 작업
exports.CombineAudio = (videoPath, audioPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Combine Audio Start!`)

            // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`,
                    [
                        `/c`, `ffmpeg`,
                        `-i`, `${videoPath}/combine.mp4`,
                        `-i`, `${audioPath}`,
                        `-c:v`, `copy`,
                        `-filter_complex`, `amix`,
                        `-map`, `0:v`,
                        `-map`, `0:a`,
                        `-map`, `1:a`,
                        `${videoPath}/result.mp4`, `-y`
                    ]
                    , { cwd: ffmpegPath })


            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process(ConcatAudio) exited with code ' + code)

                try {
                    await sleep(1000)

                    // 필요없는 파일을 제거해준다.
                    let files = await retry(ReadDirAsync(`${videoPath}`))
                    for (let i = 0; i < files.length; i++) {
                        files[i] = files[i].toLowerCase()
                        if (files[i] == `combine.mp4` && await AccessAsync(`${videoPath}/${files[i]}`)) {
                            try {
                                await retry(UnlinkAsync(`${videoPath}/${files[i]}`))
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/result.mp4`)))) {
                        return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_COMBINE_AUDIO_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_COMBINE_AUDIO_FAILED (렌더링 실패)`)
        }
    })
}

// 오디오 파일을 영상에 입히는 작업
exports.ScaleWatermark = (watermarkPath, baseWatermarkWidth, baseWatermarkHeight, videoPath, videoWidth, videoHeight, outputFileName) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Watermark Scaling Start!`)

            const threshold = 1080
            const currentThreshold = videoWidth < videoHeight ? videoWidth : videoHeight

            let scaledWatermarkWidth = 0
            let scaledWatermarkHeight = 0

            let scaleFactor = 1
            if (threshold !== currentThreshold) {
                scaleFactor = currentThreshold / threshold
            }

            scaledWatermarkWidth = Math.floor(baseWatermarkWidth * scaleFactor)
            scaledWatermarkHeight = Math.floor(baseWatermarkHeight * scaleFactor)

            // 워터마크 크기를 조정한다.
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, watermarkPath, '-vf', `scale=${scaledWatermarkWidth}:${scaledWatermarkHeight}`, `${videoPath}/${outputFileName}`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    await sleep(1000)

                    // 출력된 png 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/${outputFileName}`)))) {
                        return reject(`ERR_SCALED_WATERMARK_NOT_FOUND (렌더링 실패)`)
                    }
                    else {
                        return resolve({
                            scaleFactor,
                            scaledWatermarkWidth,
                            scaledWatermarkHeight
                        })
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_SCALE_WATERMARK_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_SCALE_WATERMARK_FAILED (렌더링 실패)`)
        }
    })
}

// 오디오 파일을 영상에 입히는 작업
exports.PutWatermark = (videoPath, inputFilePath, outputFilePath, watermarkFileName, watermarkPositionX, watermarkPositionY) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Put Watermark Start!`)

            // 워터마크를 씌운다.
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}/${inputFilePath}`, '-i', `${videoPath}/${watermarkFileName}`, '-filter_complex', `overlay=${watermarkPositionX}:${watermarkPositionY}`, `${videoPath}/${outputFilePath}`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    await sleep(1000)

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(`${videoPath}/${outputFilePath}`)))) {
                        return reject(`ERR_SEALED_MP4_NOT_FOUND (렌더링 실패)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_SEAL_WATERMARK_FAILED (렌더링 실패)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_SEAL_WATERMARK_FAILED (렌더링 실패)`)
        }
    })
}

// resize
exports.ResizeMP4 = (videoPath, width, height, scaleFactor) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`ResizeMP4 Start!`)

            const index = videoPath.indexOf('.mp4')
            const resizedVideoPath = `${videoPath.slice(0, index)}_small.mp4`

            width = Math.floor(width * scaleFactor)
            height = Math.floor(height * scaleFactor)

            if (width % 2 === 1) width -= 1
            if (height % 2 === 1) height -= 1
            
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}`, `-vf`, `scale=${width}:${height}`, `-crf`, `30`, `${resizedVideoPath}`, `-y`], { cwd: ffmpegPath })

            // 프로세스 수행 중 print 이벤트 발생 시 콜백
            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)

                try {
                    await sleep(1000)

                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(resizedVideoPath)))) {
                        return reject(`ERR_RESIZED_MP4_NOT_EXIST`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_RESIZE_MP4_FAILED`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_RESIZE_MP4_FAILED`)
        }
    })
}