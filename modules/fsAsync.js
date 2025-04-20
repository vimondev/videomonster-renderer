const fs = require('fs')
const { promisify } = require('util')

const WriteFileAsync = (path, data, options) => {
    return promisify(fs.writeFile)(path, data, options)
}
exports.WriteFileAsync = WriteFileAsync

const AccessAsync = path => {
    return promisify(fs.access)(path)
}
exports.AccessAsync = AccessAsync

const AccessAsyncBoolean = async path => {
    try {
        await promisify(fs.access)(path)
        return true
    }
    catch (e) {
        console.log(e)
        return false
    }
}
exports.AccessAsyncBoolean = AccessAsyncBoolean

const IsExistAsync = (path) => {
    return new Promise(resolve => {
        fs.access(path, (err) => {
            if (err) resolve(false)
            else resolve(true)
        })
    })
}
exports.IsExistAsync = IsExistAsync

const ReadFileAsync = (path, options) => {
    return new Promise((resolve, reject) => {
        fs.readFile(path, options, (err, data) => {
            if (err) reject(err)
            else resolve(data)
        })
    })
}
exports.ReadFileAsync = ReadFileAsync

const ReadDirAsync = (path) => {
    return new Promise((resolve, reject) => {
        fs.readdir(path, (err, files) => {
            if (err) reject(err)
            else resolve(files)
        })
    })
}
exports.ReadDirAsync = ReadDirAsync

const RenameAsync = (oldPath, newPath) => {
    return new Promise((resolve, reject) => {
        fs.rename(oldPath, newPath, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}
exports.RenameAsync = RenameAsync

const CopyFileAsync = (path, destinationPath) => {
    return new Promise((resolve, reject) => {
        fs.copyFile(path, destinationPath, err => {
            if (err) reject(err)
            else resolve()
        })
    })
}
exports.CopyFileAsync = CopyFileAsync

const UnlinkAsync = (path) => {
    return new Promise((resolve, reject) => {
        fs.unlink(path, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}
exports.UnlinkAsync = UnlinkAsync

const RemoveDirAsync = (path) => {
    return new Promise((resolve, reject) => {
        fs.rmdir(path, (err) => {
            if (err) reject(err)
            else resolve()
        })
    })
}
exports.RemoveDirAsync = RemoveDirAsync

const LstatAsync = (path) => {
    return new Promise((resolve, reject) => {
        fs.lstat(path, (err, stats) => {
            if (err) reject(err)
            else resolve(stats)
        })
    })
}
exports.LstatAsync = LstatAsync

const MkdirAsync = async path => {
    try {
        await promisify(fs.mkdir)(path)
    }
    catch (e) {
        if (e && e.code === 'EEXIST') return null
        else throw e
    }
}
exports.MkdirAsync = MkdirAsync

const Mkdirp = async path => {
    if (!path || path.length === 0) throw new Error('invalid path')
    path = path.replace(/\\/gi, '/')

    const paths = path.split('/')
    let currentPath = ''
    
    for (let i=0; i<paths.length; i++) {
        currentPath += `${paths[i]}/`
        if (!(await IsExistAsync(currentPath))) await MkdirAsync(currentPath)
    }
}
exports.Mkdirp = Mkdirp

const GetFolderFileList = (path) => {
    return new Promise(async (resolve, reject) => {
        try {
            const arr = []
            const files = await ReadDirAsync(path)

            for (let i=0; i<files.length; i++) {
                const file = path + '/' + files[i]
                const lstat = await LstatAsync(file)
                if (lstat.isDirectory()) {
                    const resArr = await GetFolderFileList(file)
                    arr.push(...resArr)
                }
                else arr.push(file)
            }

            resolve(arr)
        }
        catch (e) {
            reject(e)
        }
    })
}
exports.GetFolderFileList = GetFolderFileList

const UnlinkFolderRecursive = (path) => {
    return new Promise(async (resolve, reject) => {
        try {
            const files = await ReadDirAsync(path)

            for (let i=0; i<files.length; i++) {
                const file = path + '/' + files[i]
                const lstat = await LstatAsync(file)
                if (lstat.isDirectory()) {
                    await UnlinkFolderRecursive(file)
                }
                else await UnlinkAsync(file)
            }
            await RemoveDirAsync(path)
            resolve()
        }
        catch (e) {
            reject(e)
        }
    })
}
exports.UnlinkFolderRecursive = UnlinkFolderRecursive

const UnlinkFolderRecursiveIgnoreError = (path) => {
    return new Promise(async (resolve, reject) => {
        try {
            const files = await ReadDirAsync(path)

            for (let i=0; i<files.length; i++) {
                const file = path + '/' + files[i]
                try {
                    const lstat = await LstatAsync(file)
                    if (lstat.isDirectory()) {
                        await UnlinkFolderRecursive(file)
                    }
                    else await UnlinkAsync(file)
                }
                catch (e) {}
            }
            try {
                await RemoveDirAsync(path)
            }
            catch (e) {}
            resolve()
        }
        catch (e) {
        }
    })
}
exports.UnlinkFolderRecursiveIgnoreError = UnlinkFolderRecursiveIgnoreError