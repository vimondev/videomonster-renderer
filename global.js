const fs = require(`fs`)
const config = require(`./config`)
const {
    aerenderPath,
    fontPath
} = config

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

exports.InstallFont = (path) => {
    if (fs.existsSync(fontPath) && fs.existsSync(path)) {
        const files = fs.readdirSync(path)
        for (let i=0; i<files.length; i++) {
            const file = files[i]
            if (!fs.existsSync(`${fontPath}/${file}`)) {
                fs.copyFileSync(`${path}/${file}`, `${fontPath}/${file}`)
                console.log(`${file} is installed!`)
            }
            else 
                console.log(`${file} is already installed.`)
        }
    }
}