const fs = require(`fs`)
const config = require(`../config`)
const {
    templatePath,
    outputPath,
    localPath,
    aerenderPath,
    ffmpegPath
} = config

let totalRenderedFrameCount = 0
let totalConvertedFrameCount = 0

exports.ResetTotalRenderedFrameCount = () => {
    totalRenderedFrameCount = 0
    totalConvertedFrameCount = 0
}

exports.GetTotalRenderedFrameCount = () => {
    return (totalRenderedFrameCount + totalConvertedFrameCount) / 2
}

exports.AudioRender = (aepPath, audioPath, totalFrameCount) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Audio Render Start!`)

            const spawn = require(`child_process`).spawn,
                //ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"AIFF 48kHz"`, `-output`, `"${localPath}/${rendererIndex}/frames.aif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })
                
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `0`, `-e`, `${Number(totalFrameCount) - 1}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"AIFF 48kHz"`, `-output`, `"${audioPath}/audio.aif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)

                if (!fs.existsSync(`${audioPath}/audio.aif`)) {
                    return reject(`ERR_AUDIO_FILE_NOT_EXIST (오디오 렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_AUDIO_RENDER_FAILED (오디오 렌더링 실패)`)
        }
    })
}

exports.VideoRender = (rendererIndex, aepPath, startFrame, endFrame, hashTagString) => {
    return new Promise((resolve, reject) => {
        try {
            const frameDuration = {}
            let nowTime = Date.now()

            console.log(`Video Render Start!`)
            // 시작 전에 반드시 localPath 청소
            if (fs.existsSync(`${localPath}`)) {
                if (fs.existsSync(`${localPath}/${rendererIndex}`)) {
                    let files = fs.readdirSync(`${localPath}/${rendererIndex}`)
                    for (let i = 0; i < files.length; i++) {
                        fs.unlinkSync(`${localPath}/${rendererIndex}/${files[i]}`)
                    }
                }
                else
                    fs.mkdirSync(`${localPath}/${rendererIndex}`)
            }

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"TIFF Sequence with Alpha"`, `-output`, `"${localPath}/${rendererIndex}/frames[${hashTagString}].tif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })
                
                //ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Target"`, `-s`, `${startFrame}`, `-e`, `${endFrame}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"Lossless"`, `-output`, `"${localPath}/${rendererIndex}/out.avi"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            ls.stdout.on('data', function (data) {
                data = String(data)
                console.log('stdout: ' + data)

                if (data.includes(`PROGRESS:`) && data.includes(`(`) && data.includes(`)`)) {
                    totalRenderedFrameCount = Math.min(totalRenderedFrameCount + 1, Number(endFrame) - Number(startFrame) + 1)
                    
                    const startIndex = data.indexOf(`(`) + 1
                    const endIndex = data.indexOf(`)`)

                    const frame = data.substring(startIndex, endIndex)
                    if(!isNaN(Number(frame))) frameDuration[frame] = Date.now() - nowTime
                }
                nowTime = Date.now()
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)

                totalRenderedFrameCount = Number(endFrame) - Number(startFrame) + 1

                let files = fs.readdirSync(`${localPath}/${rendererIndex}`).sort()
                // if (files.length != Number(endFrame) - Number(startFrame) + 1) return reject(`ERR_MISMATCH_FILECOUNT`)
                // else
                {
                    try {
                        for (let i=0; i<files.length; i++) {
                            let digit = ``
                            while (digit.length < hashTagString.length - String(i).length) digit += `0`
                            digit += i
    
                            let filename = `frames${digit}.tif`
                            fs.renameSync(`${localPath}/${rendererIndex}/${files[i]}`, `${localPath}/${rendererIndex}/${filename}`)
                        }
                    }
                    catch (e) {
                        console.log(e)
                        return reject(`ERR_RENAME_FILE_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                    }
                    return resolve(frameDuration)
                }

                // if (!fs.existsSync(`${localPath}/${rendererIndex}/out.avi`)) return reject(`ERR_AVI_FILE_NOT_EXIST (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                // else return resolve()
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_VIDEO_RENDER_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
        }
    })
}

exports.MakeMP4 = (rendererIndex, videoPath, hashTagString, frameRate) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`MakeMP4 Start!`)

            let digit = ``
            while(digit.length < 3 - String(hashTagString.length).length) digit += `0`
            digit += hashTagString.length

            const spawn = require(`child_process`).spawn,
                //ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-framerate`, `${frameRate}`, `-i`, `${localPath}/${rendererIndex}/frames%${digit}d.tif`, `-i`, `${localPath}/${rendererIndex}/frames.aif`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })
                
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-framerate`, `${frameRate}`, `-i`, `${localPath}/${rendererIndex}/frames%${digit}d.tif`, `-c:v`, `libx264`, `-pix_fmt`, `yuv420p`, `-r`, `${frameRate}`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })
                
                // ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${localPath}/${rendererIndex}/out.avi`, `-c:v`, `libx264`, `-framerate`, `${frameRate}`, `-pix_fmt`, `yuv420p`, `${videoPath}/out${rendererIndex}.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)

                const str = String(data)
                if (str.includes(`frame=`) && str.includes(`fps`)) {
                    const startIndex = str.indexOf(`frame=`, 0) + 6
                    const endIndex = str.indexOf(`fps`)
    
                    totalConvertedFrameCount = Number(str.substring(startIndex, endIndex))
                }
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)

                let files = fs.readdirSync(`${localPath}/${rendererIndex}`)
                for (let i = 0; i < files.length; i++) {
                    if (fs.existsSync(`${localPath}/${rendererIndex}/${files[i]}`)) {
                        try {
                            fs.unlinkSync(`${localPath}/${rendererIndex}/${files[i]}`)
                        } catch (e) {
                            console.log(e)
                        }
                    }
                }
                
                // if (fs.existsSync(`${localPath}/${rendererIndex}/out.avi`)) 
                //     fs.unlinkSync(`${localPath}/${rendererIndex}/out.avi`)

                if (!fs.existsSync(`${videoPath}/out${rendererIndex}.mp4`)) {
                    return reject(`ERR_MP4_NOT_EXIST (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_MAKE_MP4_FAILED (${rendererIndex}번 비디오 렌더러 렌더링 실패)`)
        }
    })
}

exports.Merge = (rendererCount, videoPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Merge Start!`)

            let fileBody = ``
            for (let i = 0; i < rendererCount; i++) {
                fileBody += `file out${i}.mp4\n`
            }

            fs.writeFileSync(`${videoPath}/file.txt`, fileBody)

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-f`, `concat`, `-safe`, `0`, `-i`, `${videoPath}/file.txt`, `-c`, `copy`, `${videoPath}/merge.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)

                let files = fs.readdirSync(`${videoPath}`)
                for (let i = 0; i < files.length; i++) {
                    if ((files[i].includes(`out`, 0) && files[i].includes(`.mp4`, 0) || files[i] == `file.txt`) && fs.existsSync(`${videoPath}/${files[i]}`)) {
                        try {
                            fs.unlinkSync(`${videoPath}/${files[i]}`)
                        } catch (e) {
                            console.log(e)
                        }
                    }
                }

                if (!fs.existsSync(`${videoPath}/merge.mp4`)) {
                    return reject(`ERR_MERGE_FILE_NOT_EXIST (렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_MERGE_FAILED (렌더링 실패)`)
        }
    })
}

exports.ConcatAudio = (videoPath, audioPath) => {
    return new Promise((resolve, reject) => {
        try {
            console.log(`Concat Audio Start!`)

            //ffmpeg -i INPUT.mp4 -i AUDIO.wav -shortest -c:v copy -c:a aac -b:a 256k OUTPUT.mp4

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `ffmpeg`, `-i`, `${videoPath}/merge.mp4`, `-i`, `${audioPath}/audio.aif`, `-c:v`, `copy`, `-c:a`, `aac`, `-b:a`, `256k`, `${videoPath}/result.mp4`, `-y`], { cwd: ffmpegPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)

                let files = fs.readdirSync(`${videoPath}`)
                for (let i = 0; i < files.length; i++) {
                    if (files[i] == `merge.mp4` && fs.existsSync(`${videoPath}/${files[i]}`)) {
                        try {
                            fs.unlinkSync(`${videoPath}/${files[i]}`)
                        } catch (e) {
                            console.log(e)
                        }
                    }
                }

                if (!fs.existsSync(`${videoPath}/result.mp4`)) {
                    return reject(`ERR_RESULT_FILE_NOT_EXIST (렌더링 실패)`)
                }
                else {
                    return resolve()
                }
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_CONCAT_AUDIO_FAILED (렌더링 실패)`)
        }
    })
}