const fs = require(`fs`)
const config = require(`../config`)
const {
    templatePath,
    outputPath,
    localPath,
    aerenderPath,
    ffmpegPath
} = config

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
            console.log(`Audio Render Start!`)

            // 오디오 렌더링을 수행한다. (분산 렌더링 없이 처음부터 끝까지)
            const spawn = require(`child_process`).spawn,
                
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `0`, `-e`, `${Number(totalFrameCount) - 1}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"AIFF 48kHz"`, `-output`, `"${audioPath}/audio.aif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)
                try {
                    await sleep(2000)

                    // 출력된 AIF 파일이 있는지 검사
                    if (!(await AccessAsync(`${audioPath}/audio.aif`))) {
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
            const frameDuration = {}
            let nowTime = Date.now()

            console.log(`Video Render Start!`)
            // 시작 전에 반드시 localPath 청소
            if (await AccessAsync(localPath)) {
                if (await AccessAsync(`${localPath}/${rendererIndex}`)) {
                    let files = await ReadDirAsync(`${localPath}/${rendererIndex}`)
                    for (let i = 0; i < files.length; i++) {
                        // 기존 팡닐들 모두 삭제
                        await UnlinkAsync(`${localPath}/${rendererIndex}/${files[i]}`)
                    }
                }
                // 기존에 생성된 폴더가 없을 경우 생성
                else
                    await MkdirAsync(`${localPath}/${rendererIndex}`)
            }

            // startFrame ~ endFrame까지 부분 렌더링 (TIFF로 뽑아낸다.)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"TIFF Sequence with Alpha"`, `-output`, `"${localPath}/${rendererIndex}/frames[${hashTagString}].tif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

                // 프로세스 수행 중 print 이벤트 발생 시 콜백
            ls.stdout.on('data', function (data) {
                data = String(data)
                console.log('stdout: ' + data)

                // PROGRESS: (frameIndex) 로 출력되는 결과에서 frameIndex 값을 가져온다.
                if (data.includes(`PROGRESS:`) && data.includes(`(`) && data.includes(`)`)) {
                    // totalRenderedFrameCount을 하나씩 증가시켜준다. (단, 총 프레임 수보다 더 값이 높아지지 않게 막아놓음)
                    totalRenderedFrameCount = Math.min(totalRenderedFrameCount + 1, Number(endFrame) - Number(startFrame) + 1)
                    
                    const startIndex = data.indexOf(`(`) + 1
                    const endIndex = data.indexOf(`)`)

                    // 각 frame 렌더링에 걸린 시간을 계산하여 frameDuration에 저장한다.
                    const frame = data.substring(startIndex, endIndex)
                    if(!isNaN(Number(frame))) frameDuration[frame] = Date.now() - nowTime
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

                    await sleep(2000)
                    let files = (await ReadDirAsync(`${localPath}/${rendererIndex}`)).sort()

                    // 각 TIFF 파일을 Rename해준다. (ffmpeg 돌리려면 프레임 숫자가 0부터 시작해야함.)
                    for (let i=0; i<files.length; i++) {
                        let digit = ``
                        while (digit.length < hashTagString.length - String(i).length) digit += `0`
                        digit += i

                        let filename = `frames${digit}.tif`
                        await RenameAsync(`${localPath}/${rendererIndex}/${files[i]}`, `${localPath}/${rendererIndex}/${filename}`)
                    }
                }
                catch (e) {
                    console.log(e)
                    return reject(`ERR_RENAME_FILE_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
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

            let digit = ``
            while(digit.length < 3 - String(hashTagString.length).length) digit += `0`
            digit += hashTagString.length

            // h264 인코딩을 수행한다.
            const spawn = require(`child_process`).spawn,                
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-framerate`, `${frameRate}`, `-i`, `${localPath}/${rendererIndex}/frames%${digit}d.tif`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })

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
                    await sleep(2000)
    
                    // 렌더링이 완료된 후 TIFF 파일 제거
                    let files = await ReadDirAsync(`${localPath}/${rendererIndex}`)
                    for (let i = 0; i < files.length; i++) {
                        if (await AccessAsync(`${localPath}/${rendererIndex}/${files[i]}`)) {
                            try {
                                await UnlinkAsync(`${localPath}/${rendererIndex}/${files[i]}`)
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }
    
                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await AccessAsync(`${videoPath}/out${rendererIndex}.mp4`))) {
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

            await WriteFileAsync(`${videoPath}/file.txt`, fileBody)

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
                    await sleep(2000)
    
                    // 필요없는 파일들을 제거해준다.
                    let files = await ReadDirAsync(`${videoPath}`)
                    for (let i = 0; i < files.length; i++) {
                        if ((files[i].includes(`out`, 0) && files[i].includes(`.mp4`, 0) || files[i] == `file.txt`) && await AccessAsync(`${videoPath}/${files[i]}`)) {
                            try {
                                await UnlinkAsync(`${videoPath}/${files[i]}`)
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }
    
                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await AccessAsync(`${videoPath}/merge.mp4`))) {
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

// 오디오 파일을 영상에 입히는 작업
exports.ConcatAudio = (videoPath, audioPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Concat Audio Start!`)

            // 오디오 파일을 영상에 입혀준다. (AAC 코덱)
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}/merge.mp4`, `-i`, `${audioPath}/audio.aif`, `-c:v`, `copy`, `-c:a`, `aac`, `-b:a`, `256k`, `${videoPath}/result.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)
                
                try {
                    await sleep(2000)
    
                    // 필요없는 파일을 제거해준다.
                    let files = await ReadDirAsync(`${videoPath}`)
                    for (let i = 0; i < files.length; i++) {
                        if (files[i] == `merge.mp4` && await AccessAsync(`${videoPath}/${files[i]}`)) {
                            try {
                                await UnlinkAsync(`${videoPath}/${files[i]}`)
                            } catch (e) {
                                console.log(e)
                            }
                        }
                    }
    
                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await AccessAsync(`${videoPath}/result.mp4`))) {
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

// 오디오 파일을 영상에 입히는 작업
exports.ScaleWatermark = (watermarkPath, videoPath, width, height) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Watermark Scaling Start!`)

            const threshold = 1080
            const currentThreshold = width < height ? width : height

            const baseWatermarkWidth = 275
            const baseWatermarkHeight = 115

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
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, watermarkPath, '-vf', `scale=${scaledWatermarkWidth}:${scaledWatermarkHeight}`, `${videoPath}/scaledwatermark.png`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)
                
                try {
                    await sleep(2000)
    
                    // 출력된 png 파일이 존재하지 않으면 실패
                    if (!(await AccessAsync(`${videoPath}/scaledwatermark.png`))) {
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
exports.PutWatermark = (videoPath, width, height, scaledData) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Put Watermark Start!`)

            const { scaleFactor, scaledWatermarkWidth, scaledWatermarkHeight } = scaledData

            const scaledGapX = Math.floor(70 * scaleFactor)
            const scaledGapY = Math.floor(60 * scaleFactor)

            const watermarkPositionX = scaledGapX
            const watermarkPositionY = height - scaledWatermarkHeight - scaledGapY

            // 워터마크를 씌운다.
            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}/result.mp4`, '-i', `${videoPath}/scaledwatermark.png`, '-filter_complex', `overlay=${watermarkPositionX}:${watermarkPositionY}`, `${videoPath}/sealed.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', async function (code) {
                console.log('child process exited with code ' + code)
                
                try {
                    await sleep(2000)
    
                    // 출력된 mp4 파일이 존재하지 않으면 실패
                    if (!(await AccessAsync(`${videoPath}/sealed.mp4`))) {
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