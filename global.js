const fs = require(`fs`)
const path = require(`path`)
const config = require(`./config`)
const {
    aerenderPath,
    fontPath
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

function CopyFileAsync(src, dest) {
    return new Promise((resolve, reject) => {
        fs.copyFile(src, dest, err => {
            resolve()
        })
    })
}

function TaskKill(task) {
    return new Promise((resolve, reject) => {
        const spawn = require(`child_process`).spawn,
            ls = spawn(`cmd`, [`/c`, `taskkill`, `/im`, task, `-f`])

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
    })

}

exports.TaskKill = TaskKill

exports.LaunchAfterFX = () => {
    return new Promise((resolve, reject) => {
        const spawn = require(`child_process`).spawn,
            ls = spawn(`cmd`, [`/c`, `afterfx`, `-noui`], { cwd: aerenderPath })

        let msg = ``

        ls.stdout.on('data', function (data) {
            console.log('stdout: ' + data)
            msg += data

            if (data.includes(`Using DXGI`, 0)) {
                msg = ``
                resolve()
            }
        })

        ls.stderr.on('data', function (data) {
            console.log('stderr: ' + data)
        })

        ls.on('exit', function (code) {
            console.log('child process exited with code ' + code)
        })
    })
}

exports.InstallFont = async (path) => {
    if (await AccessAsync(fontPath) && await AccessAsync(path)) {
        const files = await ReadDirAsync(path)
        for (let i=0; i<files.length; i++) {
            const file = files[i]

            await CopyFileAsync(`${path}/${file}`, `${fontPath}/${file}`)
            console.log(`${file} is installed!`)
            // if (!(await AccessAsync(`${fontPath}/${file}`))) {
            //     await CopyFileAsync(`${path}/${file}`, `${fontPath}/${file}`)
            //     console.log(`${file} is installed!`)
            // }
            // else 
            //     console.log(`${file} is already installed.`)
        }
    }
}

exports.InstallGlobalFont = async installFontMap => {
    const keys = Object.keys(installFontMap)

    for (let i=0; i<keys.length; i++) {
        const filepath = installFontMap[keys[i]]
        const filename = path.basename(filepath)

        await CopyFileAsync(filepath, `${fontPath}/${filename}`)
        console.log(`${filename} is installed!`)
        // if (!(await AccessAsync(`${fontPath}/${filename}`))) {
        //     await CopyFileAsync(filepath, `${fontPath}/${filename}`)
        //     console.log(`${filename} is installed!`)
        // }
        // else 
        //     console.log(`${filename} is already installed.`)
    }
}

exports.ClearTask = async () => {
    await TaskKill('AfterFX.com')
    await TaskKill('AfterFX.exe')
    await TaskKill('aerender.exe')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

exports.retry = async callback => {
    for (let i = 0; i < 24; i++) {
        try {
            return await callback
        } catch (e) {
            console.log(`execute failed. retry after 5 seconds...`)
            await sleep(5000)
        }
    }
    throw new Error('CALLBACK EXECUTE FAILED!!')
}


exports.retryBoolean = async callback => {
    for (let i = 0; i < 24; i++) {
        try {
            const result = await callback
            if (result) return true
            else throw new Error()
        } catch (e) {
            console.log(`execute failed. retry after 5 seconds...`)
            await sleep(5000)
        }
    }
    throw new Error('CALLBACK EXECUTE FAILED!!')
}