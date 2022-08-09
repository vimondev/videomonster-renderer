const fs = require(`fs`)
const jimp = require(`jimp`)
const config = require(`../config`)
const {
    localPath,
    aerenderPath
} = config
const path = require('path')
const sharp = require('sharp')
sharp.cache(false)

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

/**
 * 기준 해상도에 맞춰 가로/세로 비율을 유지한 최소 사이즈를 계산하는 함수
 * @param {Number} standardWidth 기준 가로
 * @param {Number} standardHeight 기준 세로
 * @param {Number} originWidth 원본 가로
 * @param {Number} originHeight 원본 세로
 * @returns 
 */
exports.CalMinResolution = (standardWidth, standardHeight, originWidth, originHeight) => {
    let width = standardWidth;
    let height = standardHeight;

    const originRatio = originHeight / originWidth;
    const standardRatio = standardHeight / standardWidth;
    if (originRatio > standardRatio) {
        // 가로가 더 긴 경우
        height = originHeight * (standardWidth / originWidth);
    }
    else if (originRatio < standardRatio) {
        // 세로가 더 긴 경우
        width = originWidth * (standardHeight / originHeight);
    }
    return { width, height };
}

/**
 * 이미지를 최적화 해주는 함수
 * @param {string} inputFilePath 
 * @param {string} outputFilePath 
 * @param {{
 *  quality: Number
 *  resize: {
 *      width: Number
 *      height: Number 
 *  } | null
 * }} options 
 */
exports.Optimize = async (inputFilePath, outputFilePath, options = { 
    quality: null,
    resize: null
}) => {
    try {
        const { quality, resize } = options
        const fileName = path.basename(inputFilePath)
        const _quality = quality ? Number(quality) : 50
        console.time('[ IMAGE SHARP ] ' + fileName)

        const originFormat = path.extname(fileName)

        const image = sharp(inputFilePath)
        image.on('error', (e) => { console.log(e) })
    
        const { width, height } = await image.metadata()
        const size = { width, height }
        console.log({ label: "Origin-Size", width, height, name: fileName })
        if (resize && resize.width && resize.height) {
            size.width = resize.width
            size.height = resize.height
        }
        console.log({ label: "Re-Size", ...size, name: fileName })

        if (originFormat === '.jpg' | originFormat === '.jpeg') {
            await image
            .withMetadata()
            .rotate()
            .resize(size)
            .jpeg({ quality: _quality })
            .toFile(outputFilePath)
        }
        else {
            await image
                .withMetadata()
                .rotate()
                .resize(size)
                .png({ quality: _quality })
                .toFile(outputFilePath)
        }

        // await image
        //     .withMetadata()
        //     .rotate()
        //     .resize(resize)
        //     .webp({ quality })
        //     .toFile(basepath + fileName.replace(originFormat, '_comp.webp'))

        // await image
        //     .withMetadata()
        //     .rotate()
        //     .resize(resize)
        //     .tiff({ quality })
        //     .toFile(basepath + fileName.replace(originFormat, '_comp.tiff'))
    
        image.destroy()  

        console.timeEnd('[ IMAGE SHARP ] ' + fileName)
    }
    catch (e) {
        console.log(e)
    }
}
