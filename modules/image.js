const fs = require(`fs`)
const jimp = require(`jimp`)
const config = require(`../config`)
const {
    templatePath,
    outputPath,
    localPath,
    aerenderPath
} = config

exports.ImageRender = (aepPath, imageList) => {
    return new Promise((resolve, reject) => {
        try {
            if (!fs.existsSync(`${localPath}/image`)) {
                fs.mkdirSync(`${localPath}/image`)
            }

            let maxLength = 0
            for(let i=0; i<imageList.length; i++) {
                maxLength = Math.max(maxLength, imageList[i].FileName.replace(`CUT`, ``).length)
            }

            let hashTagStr = ``
            for (let i=0; i<maxLength; i++) {
                hashTagStr += `#`
            }

            const spawn = require(`child_process`).spawn,
                ls = spawn(`cmd`, [`/c`, `aerender`, `-project`, `"${aepPath}"`, `-comp`, `"#Previews"`, `-s`, `0`, `-e`, `${imageList.length - 1}`, `-RStemplate`, `"Best Settings"`, `-OMtemplate`, `"TIFF Sequence with Alpha"`, `-output`, `"${localPath}/image/[${hashTagStr}].tif"`, `-continueOnMissingFootage`], { cwd: aerenderPath })

            ls.stdout.on('data', function (data) {
                console.log('stdout: ' + data)
            })

            ls.stderr.on('data', function (data) {
                console.log('stderr: ' + data)
            })

            ls.on('exit', function (code) {
                console.log('child process exited with code ' + code)
                resolve()
            })
        }
        catch (e) {
            console.log(e)
            reject(`ERR_IMAGE_RENDER_FAILED (이미지 렌더링 실패)`)
        }
    })
}

exports.ConvertTIFFToPng = (imagePath, imageList) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!fs.existsSync(`${localPath}/image`)) return reject(`ERR_IMAGE_RENDER_FAILED (이미지 렌더링 실패)`)

            const images = fs.readdirSync((`${localPath}/image`))
            const tiffs = []

            for (let i=0; i<images.length; i++) {
                if (images[i].includes(`.tif`, 0))
                    tiffs.push(images[i])
            }

            const filenameMap = {}
            for (let i=0; i<imageList.length; i++) {
                let num = Number(imageList[i].FileName.replace(`Cut`, ``) - 1)
                filenameMap[num] = imageList[i].FileName
            }

            if (!fs.existsSync(imagePath)) fs.mkdirSync(imagePath)

            for (let i=0; i<tiffs.length; i++) {
                try {
                    let tiff = await jimp.read(`${localPath}/image/${tiffs[i]}`)
                    let resizedWidth = parseInt(tiff.getWidth() / 4)
                    let resizedHeight = parseInt(tiff.getHeight() / 4)

                    let filename = filenameMap[Number(tiffs[i].replace(`.tif`, ``))] + `.jpg`
                    tiff.resize(resizedWidth, resizedHeight).write(`${imagePath}/${filename}`)
                }
                catch (e) {
                    console.log(e)
                    return reject(`ERR_CONVERT_TO_JPG_FAILED (이미지 변환 실패)`)
                }
            }
            
            for (let i=0; i<images.length; i++) {
                try {
                    if(fs.existsSync(`${localPath}/image/${images[i]}`)) {
                        fs.unlinkSync(`${localPath}/image/${images[i]}`)
                    }
                }
                catch (e) {
                    console.log(e)
                }
            }

            resolve()
        }
        catch (e) {
            console.log(e)
            reject(`ERR_IMAGE_RENDER_FAILED (이미지 렌더링 실패)`)
        }
    })
}