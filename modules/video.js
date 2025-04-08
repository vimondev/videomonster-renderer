const fs = require(`fs`)
const path = require(`path`)
const config = require(`../config`)
const {
    localPath,
    aerenderPath,
    ffmpegPath
} = config
const fsAsync = require('./fsAsync')
const ytDlp = require('./ytDlp')
const { retry, retryBoolean, TaskKill } = require('../global')

function AccessAsync(_path) {
    return new Promise((resolve, reject) => {
        fs.access(_path, err => {
            if (err) resolve(false)
            else resolve(true)
        })
    })
}

function ReadDirAsync(_path) {
    return new Promise((resolve, reject) => {
        fs.readdir(_path, (err, files) => {
            if (err) reject(err)
            else resolve(files)
        })
    })
}

function UnlinkAsync(_path) {
    return new Promise((resolve, reject) => {
        fs.unlink(_path, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}

function MkdirAsync(_path) {
    return new Promise((resolve, reject) => {
        fs.mkdir(_path, err => {
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

function WriteFileAsync(_path, data) {
    return new Promise((resolve, reject) => {
        fs.writeFile(_path, data, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 렌더링 진행률 보고를 위한 변수
let totalRenderedFrameCount = 0     // aerender 프로세스로 렌더링 된 프레임 개수
let totalConvertedFrameCount = 0    // ffmpeg 프로세스로 h264로 인코딩된 프레임 개수

let processPercentage = 0

// 초기화
exports.ResetTotalRenderedFrameCount = () => {
    totalRenderedFrameCount = 0
    totalConvertedFrameCount = 0
}

exports.ResetProcessPercentage = () => {
    processPercentage = 0
}

exports.GetTotalRenderedFrameCount = () => {
    return (totalRenderedFrameCount + totalConvertedFrameCount) / 2
}

exports.GetProcessPercentage = () => {
    return processPercentage
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
exports.VideoRender = (rendererIndex, aepPath, startFrame, endFrame, hashTagString) => {
    return new Promise(async (resolve, reject) => {
        try {
            const homeDir = `${require('os').homedir()}/AppData`
            if (await fsAsync.AccessAsyncBoolean(`${homeDir}/Local/Temp`)) await fsAsync.UnlinkFolderRecursiveIgnoreError(`${homeDir}/Local/Temp`)
            if (await fsAsync.AccessAsyncBoolean(`${homeDir}/Roaming/Adobe`)) await fsAsync.UnlinkFolderRecursiveIgnoreError(`${homeDir}/Roaming/Adobe`)

            const frameDuration = {}
            let nowTime = Date.now()

            console.log(`Video Render Start!`)
            // 시작 전에 반드시 localPath 청소
            if (await AccessAsync(localPath)) {
                if (await AccessAsync(`${localPath}/${rendererIndex}`)) {
                    let files = await retry(ReadDirAsync(`${localPath}/${rendererIndex}`))
                    for (let i = 0; i < files.length; i++) {
                        // 기존 팡닐들 모두 삭제
                        await retry(UnlinkAsync(`${localPath}/${rendererIndex}/${files[i]}`))
                    }
                }
                // 기존에 생성된 폴더가 없을 경우 생성
                else
                    await retry(MkdirAsync(`${localPath}/${rendererIndex}`))
            }

            // startFrame ~ endFrame까지 부분 렌더링 (TIFF로 뽑아낸다.)
            // const spawn = require(`child_process`).spawn,
            //     ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"TIFF Sequence with Alpha"`, `-output`, `"${localPath}/${rendererIndex}/frames[${hashTagString}].tif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            // startFrame ~ endFrame까지 부분 렌더링 (AVI로 뽑아낸다.)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"Lossless"`, `-output`, `"${localPath}/${rendererIndex}/out.avi"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

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
                    // let files = (await retry(ReadDirAsync(`${localPath}/${rendererIndex}`))).sort()

                    // // 각 TIFF 파일을 Rename해준다. (ffmpeg 돌리려면 프레임 숫자가 0부터 시작해야함.)
                    // for (let i=0; i<files.length; i++) {
                    //     let digit = ``
                    //     while (digit.length < hashTagString.length - String(i).length) digit += `0`
                    //     digit += i

                    //     let filename = `frames${digit}.tif`
                    //     await retry(RenameAsync(`${localPath}/${rendererIndex}/${files[i]}`, `${localPath}/${rendererIndex}/${filename}`))
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

// 영상 파일에서 일부 영역을 gif로 추출
exports.ExportGif = (videoFilePath, outputPath, duration, startTimeSec = 0, scaleWidth = 800, scaleHeight = -1, frameRate = 10, loop = 0) => {
    return new Promise((resolve, reject) => {
        try {
            const outputFilePath = `${outputPath}/result.gif`
            const startTime = new Date(-(1000 * 60 * 60 * 9) + (1000 * startTimeSec)).toTimeString().split(" ")[0];
            console.log(`ExportGif Start! ${startTime} + ${duration}/s`)

            // ffmpeg -i result.mp4 -ss 0:00:01 -t 3 -r 8 -vf scale=1200:-1 -loop 0 output.gif
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [
                    `/c`, `ffmpeg`,
                    `-i`, `${videoFilePath}`,
                    `-ss`, `${startTime}`,
                    `-t`, `${duration}`,
                    `-r`, `${frameRate}`,
                    `-vf`, `scale=${scaleWidth}:${scaleHeight}`,
                    `-loop`, `${loop}`,
                    outputFilePath, 
                    `-y`,
                    ], {
                    cwd: ffmpegPath
                })

            // 프로세스 수행 중 print 이벤트 발생 시 콜백
            ls.stdout.on('data', function (data) {
                console.log('[ExportGif] stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('[ExportGif] stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process(ExportGif) exited with code ' + code)

                try {
                    await sleep(1000)

                    // 출력된 gif 파일이 존재하지 않으면 실패
                    if (!(await retryBoolean(AccessAsync(outputFilePath)))) {
                        return reject(`ERR_EXPORT_GIF_FAILED (렌더링된 GIF 출력 파일 없음)`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_EXPORT_GIF_FAILED (비디오 렌더러 GIF 렌더링 실패 - 2)`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_EXPORT_GIF_FAILED (비디오 렌더러 GIF 렌더링 실패 - 1)`)
        }
    })
}

const SpawnFFMpeg = args => {
    return new Promise((resolve, reject) => {
        try {
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [ `/c`, `ffmpeg`, ...args ], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })
            
            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                resolve(code)
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_SPAWN_FFMPEG_FAILED (FFMPEG 프로세스 생성 실패)`)
        }
    })
}

exports.DownloadYoutubeMetadata = async ({
    targetFolderPath,
    ytDlpCookiesPath,

    metadataJsonFileName,
    yid
}) => {
    const localDownloadDir = `${localPath}/youtube-metadata-download`
    if (await fsAsync.IsExistAsync(localDownloadDir)) await fsAsync.UnlinkFolderRecursiveIgnoreError(localDownloadDir)
    await fsAsync.Mkdirp(localDownloadDir)

    const [
        metadataJson,
    ] = await Promise.all([
        (() => {
            return ytDlp.ExecPromise([
                '--dump-json',
                `https://www.youtube.com/watch?v=${yid}`
            ], ytDlpCookiesPath)
        })(),
    ])

    const targetMetadataJsonFilePath = `${targetFolderPath}/${metadataJsonFileName}`
    await fsAsync.WriteFileAsync(targetMetadataJsonFilePath, metadataJson, { encoding: 'utf8' })
    
    if (!(await retryBoolean(AccessAsync(targetMetadataJsonFilePath)))) {
        throw new Error(`ERR_WRITE_METADATA_JSON_FAILED`)
    }
}

exports.DownloadYoutubePreviewFiles = async ({
    targetFolderPath,
    ytDlpCookiesPath,

    videoFileName,
    audioFileName,
    splittedAudioFileName,

    segmentDuration,
    overlapDuration,

    yid
}) => {
    const localDownloadDir = `${localPath}/youtube-preview-files-download`
    if (await fsAsync.IsExistAsync(localDownloadDir)) await fsAsync.UnlinkFolderRecursiveIgnoreError(localDownloadDir)
    await fsAsync.Mkdirp(localDownloadDir)

    let localVideoFilePath = `${localDownloadDir}/${videoFileName}`
    let localAudioFilePath = `${localDownloadDir}/${audioFileName}`
    let localSplittedAudioFilePath = `${localDownloadDir}/${splittedAudioFileName}`

    const [
        metadataJson,
        extname
    ] = await Promise.all([
        (() => {
            return ytDlp.ExecPromise([
                '--dump-json',
                `https://www.youtube.com/watch?v=${yid}`
            ], ytDlpCookiesPath)
        })(),
        (async () => {
            try {
                const mp4FilePath = `${localVideoFilePath}.mp4`
                await ytDlp.Exec([
                    '-f', 'bv*[height=720][ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[height=720][ext=mp4][vcodec^=avc1]',
                    '-o', mp4FilePath,
                    `https://www.youtube.com/watch?v=${yid}`
                ], ytDlpCookiesPath, percentage => {
                    processPercentage = percentage / 100
                })

                return {
                    videoExtName: `.mp4`,
                    audioExtName: `.m4a`
                }
            }
            catch (e) {
                console.log(e)
                console.log(`ERR_DOWNLOAD_MP4_YOUTUBE_FILE_FAILED. RETRY TO DOWNLOAD WEBM FILE.`)
            }
            
            try {
                const webmFilePath = `${localVideoFilePath}.webm`
                await ytDlp.Exec([
                    '-f', 'bv*[height=720][ext=webm][vcodec^=vp9]+ba[ext=webm][acodec^=opus]/b[height=720][ext=webm][vcodec^=vp9]',
                    '-o', webmFilePath,
                    `https://www.youtube.com/watch?v=${yid}`
                ], ytDlpCookiesPath, percentage => {
                    processPercentage = percentage / 100
                })

                return {
                    videoExtName: `.webm`,
                    audioExtName: `.ogg`
                }
            }
            catch (e) {
                console.log(e)
                throw new Error(`ERR_DOWNLOAD_WEBM_YOUTUBE_FILE_FAILED`)
            }
        })()
    ])

    const metadata = JSON.parse(metadataJson)
    const duration = Number(metadata.duration)

    const { videoExtName, audioExtName } = extname
    localVideoFilePath = `${localVideoFilePath}${videoExtName}`
    localAudioFilePath = `${localAudioFilePath}${audioExtName}`

    await SpawnFFMpeg([
        `-i`, `${localVideoFilePath}`,
        `-map`, `0:a`,
        `-c:a`, `copy`,
        `${localAudioFilePath}`, `-y`
    ])
    
    const targetTimes = []
    const length = Math.ceil(duration / segmentDuration)
    for (let i=0; i<length; i++) {
        const startTime = i * segmentDuration
        let endTime = startTime + segmentDuration + overlapDuration
        if (endTime > duration) {
            endTime = duration
        }
        targetTimes.push({
            startTime,
            endTime,
            splittedAudioFilePath: `${localSplittedAudioFilePath}-${i}${audioExtName}`
        })
    }

    const localSplittedAudioFilePaths = await Promise.all(
        targetTimes.map(async ({ startTime, endTime, splittedAudioFilePath }) => {
            await SpawnFFMpeg([
                '-i', localAudioFilePath,
                '-ss', startTime.toString(),
                '-to', endTime.toString(),
                '-c:a', 'copy',
                `${splittedAudioFilePath}`, `-y`
            ])

            return splittedAudioFilePath
        })
    )

    const targetCopyVideoFilePath = `${targetFolderPath}/${path.basename(localVideoFilePath)}`
    const targetCopyAudioFilePath = `${targetFolderPath}/${path.basename(localAudioFilePath)}`
    const targetCopySplittedAudioFilePaths = localSplittedAudioFilePaths.map(localSplittedAudioFilePath => `${targetFolderPath}/${path.basename(localSplittedAudioFilePath)}`)

    await Promise.all([
        fsAsync.CopyFileAsync(localVideoFilePath, targetCopyVideoFilePath),
        fsAsync.CopyFileAsync(localAudioFilePath, targetCopyAudioFilePath),
        ...localSplittedAudioFilePaths.map(
            (localSplittedAudioFilePath, index) => fsAsync.CopyFileAsync(
                localSplittedAudioFilePath,
                targetCopySplittedAudioFilePaths[index]
            )
        )
    ])

    if (!(await retryBoolean(AccessAsync(targetCopyVideoFilePath)))) {
        throw new Error(`ERR_COPY_VIDEO_FILE_FAILED`)
    }
    if (!(await retryBoolean(AccessAsync(targetCopyAudioFilePath)))) {
        throw new Error(`ERR_COPY_AUDIO_FILE_FAILED`)
    }
    for (let i=0; i<targetCopySplittedAudioFilePaths.length; i++) {
        if (!(await retryBoolean(AccessAsync(targetCopySplittedAudioFilePaths[i])))) {
            throw new Error(`ERR_COPY_SPLITTED_AUDIO_FILE_FAILED`)
        }
    }
}

// TIFF -> h264 인코딩
exports.MakeMP4 = (rendererIndex, videoPath, hashTagString, frameRate, scaleFactor = undefined) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`MakeMP4 Start!`)

            // let digit = ``
            // while(digit.length < 3 - String(hashTagString.length).length) digit += `0`
            // digit += hashTagString.length

            // h264 인코딩을 수행한다.
            // const spawn = require(`child_process`).spawn,
            //     ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-framerate`, `${frameRate}`, `-i`, `${localPath}/${rendererIndex}/frames%${digit}d.tif`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })
            
            let args
            if (scaleFactor > 0) args = [`/c`, `ffmpeg`, `-i`, `${localPath}/${rendererIndex}/out.avi`, `-vf`, `scale=iw*${scaleFactor}:ih*${scaleFactor}`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`]
            else args = [`/c`, `ffmpeg`, `-i`, `${localPath}/${rendererIndex}/out.avi`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`]
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, args, { cwd: ffmpegPath })

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
                console.log('child process(MakeMP4) exited with code ' + code)

                try {
                    await sleep(1000)

                    // 렌더링이 완료된 후 TIFF or AVI 파일 제거
                    let files = await retry(ReadDirAsync(`${localPath}/${rendererIndex}`))
                    for (let i = 0; i < files.length; i++) {
                        files[i] = files[i].toLowerCase()
                        if (await AccessAsync(`${localPath}/${rendererIndex}/${files[i]}`)) {
                            try {
                                await retry(UnlinkAsync(`${localPath}/${rendererIndex}/${files[i]}`))
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
            const fileList = await fsAsync.ReadDirAsync(videoPath)
            const fileRegex = new RegExp('out.*[0-9]\.mp4')
            let fileBody = ``
            for (let i = 0; i < fileList.length; i++) {
                const fileName = fileList[i]
                if (fileRegex.test(fileName)) {
                    fileBody += `file ${fileName}\n`
                }
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

        const localAudioPath = `${localPath}/music`
        const volumeAppliedOutputPath = `${localAudioPath}/volume_applied.m4a`
        const fadeInAudioOutputPath = `${localAudioPath}/audio_in.m4a`
        const fadeOutAudioOutputPath = `${localAudioPath}/audio_in_out.m4a`

        try {
            // 시작 전에 반드시 localPath 청소
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

const _ResizeMP4 = (inputFilePath, outputFilePath, width, height, scaleFactor) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`ResizeMP4 Start!`)

            width = Math.floor(width * scaleFactor)
            height = Math.floor(height * scaleFactor)

            if (width % 2 === 1) width -= 1
            if (height % 2 === 1) height -= 1
            
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${inputFilePath}`, `-vf`, `scale=${width}:${height}`, `-crf`, `30`, `${outputFilePath}`, `-y`], { cwd: ffmpegPath })

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
                    if (!(await retryBoolean(AccessAsync(outputFilePath)))) {
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

// resize
exports.ResizeMP4 = (videoPath, width, height, scaleFactor) => {
    const index = videoPath.indexOf('.mp4')
    const resizedVideoPath = `${videoPath.slice(0, index)}_small.mp4`
    return _ResizeMP4(videoPath, resizedVideoPath, width, height, scaleFactor)
}

exports.ResizeMP4WithPath = _ResizeMP4

exports.EncodeToMP4 = (inputVideoPath, outputVideoPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`EncodeToMP4 Start!`)

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [
                    `/c`, `ffmpeg`, 
                    `-i`, `${inputVideoPath}`, 
                    `-pix_fmt`, `yuv420p`, 
                    `-crf`, `26`,
                    `-preset`, `veryfast`,
                    `${outputVideoPath}`, 
                    `-y`
                ], { cwd: ffmpegPath })

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
                    if (!(await retryBoolean(AccessAsync(outputVideoPath)))) {
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
            reject(`ERR_ENCODING_TO_MP4_FAILED`)
        }
    })
}

exports.Screenshot = (inputFilePath, outputFilePath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Screenshot Start!`)

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [
                    `/c`, `ffmpeg`, 
                    `-i`, `${inputFilePath}`, 
                    `-ss`, `00:00:00`, 
                    `-vframes`, `1`, 
                    `${outputFilePath}`, 
                    `-y`
                ], { cwd: ffmpegPath })

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
                    if (!(await retryBoolean(AccessAsync(outputFilePath)))) {
                        return reject(`ERR_SCREENSHOT_NOT_EXIST`)
                    }
                    else {
                        return resolve()
                    }
                }
                catch (e) {
                    console.log(e)
                    reject(`ERR_SCREENSHOT_FAILED`)
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_ENCODING_TO_MP4_FAILED`)
        }
    });
}

