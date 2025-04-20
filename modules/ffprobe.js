const { spawn } = require('child_process')
const { ffmpegPath } = require(`../config`)

module.exports = function ffprobe(file) {
    return new Promise((resolve, reject) => {
        let proc = spawn(`cmd`, [`/c`, 'ffprobe', '-hide_banner', '-loglevel', 'fatal', '-show_error', '-show_format', '-show_streams', '-show_programs', '-show_chapters', '-show_private_data', '-print_format', 'json', file], { cwd: ffmpegPath })
        let probeData = []
        let errData = []

        proc.stdout.setEncoding('utf8')
        proc.stderr.setEncoding('utf8')

        proc.stdout.on('data', function (data) { probeData.push(data) })
        proc.stderr.on('data', function (data) { errData.push(data) })

        proc.on('exit', code => { exitCode = code })
        proc.on('error', err => reject(err))
        proc.on('close', () => resolve(JSON.parse(probeData.join(''))))
    })
}