var addon = require('../native');

function promisify(f) {
    return new Promise((resolve, reject) =>
        f((err, result) => {
            if (err) {
                reject(err)
            } else {
                resolve(result)
            }
        })
    )
}

class NativeSignatureVerifier {
    constructor(address) {
        this._native = new addon.NativeSignatureVerifier(address)
    }

    async verify(message, signature) {
        return await promisify((cb) => this._native.verify(cb, message, signature))
    }
}

module.exports = {
    NativeSignatureVerifier,
}