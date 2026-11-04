/**
 * Vigil unlock helper.
 * Args: <reason> [biometrics|password]
 * - biometrics: platform biometrics only (Touch ID / Face ID on Apple)
 * - password: device password / PIN only (no biometrics)
 * Prints VIGIL_AUTH=1 only on real success.
 */
import AppKit
import Foundation
import LocalAuthentication
import Security

let reason: String = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "Unlock Vigil AI Agent"

let mode: String = CommandLine.arguments.count > 2
    ? CommandLine.arguments[2].lowercased()
    : "biometrics"

FileHandle.standardError.write(Data("[vigil-bio] starting reason=\(reason) mode=\(mode)\n".utf8))

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let ctx = LAContext()
ctx.touchIDAuthenticationAllowableReuseDuration = 0

let lock = NSLock()
var resultCode: Int32 = 1
var didFinish = false
let runLoop = CFRunLoopGetMain()

func finish(success: Bool, errorMessage: String?) {
    lock.lock()
    defer { lock.unlock() }
    if didFinish { return }
    didFinish = true

    if success {
        resultCode = 0
        FileHandle.standardError.write(Data("[vigil-bio] success\n".utf8))
    } else {
        let msg = errorMessage ?? "cancelled"
        FileHandle.standardError.write(Data("[vigil-bio] failed: \(msg)\n".utf8))
        fputs(msg + "\n", stderr)
        resultCode = 1
    }
    CFRunLoopStop(runLoop)
}

if mode == "password" {
    // Force device password / PIN — do NOT use .deviceOwnerAuthentication,
    // which still prefers biometrics when available (same UI as Touch ID).
    var aclError: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .devicePasscode,
        &aclError
    ) else {
        let msg =
            (aclError?.takeRetainedValue() as Error?)?.localizedDescription
            ?? "Password unlock unavailable"
        FileHandle.standardError.write(Data("[vigil-bio] unavailable: \(msg)\n".utf8))
        fputs(msg + "\n", stderr)
        print("VIGIL_AUTH=0")
        exit(2)
    }

    FileHandle.standardError.write(Data("[vigil-bio] policy=password (devicePasscode)\n".utf8))

    ctx.evaluateAccessControl(
        access,
        operation: .createItem,
        localizedReason: reason
    ) { success, error in
        finish(success: success, errorMessage: error?.localizedDescription)
    }
} else {
    // Hide inline password button on the biometrics sheet; use explicit UI button instead.
    ctx.localizedFallbackTitle = ""
    var evalError: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evalError) else {
        let msg = evalError?.localizedDescription ?? "Biometrics unavailable"
        FileHandle.standardError.write(Data("[vigil-bio] unavailable: \(msg)\n".utf8))
        fputs(msg + "\n", stderr)
        print("VIGIL_AUTH=0")
        exit(2)
    }

    FileHandle.standardError.write(
        Data("[vigil-bio] policy=biometrics biometryType=\(ctx.biometryType.rawValue)\n".utf8)
    )

    ctx.evaluatePolicy(
        .deviceOwnerAuthenticationWithBiometrics,
        localizedReason: reason
    ) { success, error in
        finish(success: success, errorMessage: error?.localizedDescription)
    }
}

app.activate(ignoringOtherApps: true)
FileHandle.standardError.write(Data("[vigil-bio] waiting for auth UI\n".utf8))

DispatchQueue.global().async {
    Thread.sleep(forTimeInterval: 90)
    lock.lock()
    let finished = didFinish
    if !finished {
        didFinish = true
        resultCode = 1
        FileHandle.standardError.write(Data("[vigil-bio] timeout\n".utf8))
    }
    lock.unlock()
    if !finished {
        CFRunLoopStop(runLoop)
    }
}

CFRunLoopRun()

lock.lock()
let code = resultCode
lock.unlock()

print(code == 0 ? "VIGIL_AUTH=1" : "VIGIL_AUTH=0")
exit(code)
