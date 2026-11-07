/**
 * Live on-device dictation (macOS Speech framework) — VigilHub-like interim text.
 * Lines on stdout:
 *   VIGIL_DICT=AUTH ok|denied|...
 *   VIGIL_DICT=PARTIAL <text>
 *   VIGIL_DICT=FINAL <text>
 *   VIGIL_DICT=READY
 *   VIGIL_DICT=END
 * Stop: write STOP to stdin.
 */
import AVFoundation
import Foundation
import Speech

func emit(_ kind: String, _ text: String = "") {
    if text.isEmpty {
        print("VIGIL_DICT=\(kind)")
    } else {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        print("VIGIL_DICT=\(kind) \(flat)")
    }
    fflush(stdout)
}

func runSession(recognizer: SFSpeechRecognizer) {
    let audioEngine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(macOS 13, *) {
        request.addsPunctuation = true
    }

    let input = audioEngine.inputNode
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        request.append(buffer)
    }

    var lastPartial = ""
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error = error as NSError? {
            if error.code != 1110 && error.code != 301 {
                emit("ERROR", error.localizedDescription)
            }
            return
        }
        guard let result = result else { return }
        let text = result.bestTranscription.formattedString
        if result.isFinal {
            emit("FINAL", text)
            lastPartial = ""
        } else if text != lastPartial {
            lastPartial = text
            emit("PARTIAL", text)
        }
    }

    do {
        try audioEngine.start()
    } catch {
        emit("ERROR", error.localizedDescription)
        exit(1)
    }

    emit("READY")

    // Don't block the main run loop on stdin — speech callbacks need it.
    let stopFlag = LockedFlag()
    DispatchQueue.global(qos: .userInitiated).async {
        let stdin = FileHandle.standardInput
        while !stopFlag.value {
            if let data = try? stdin.read(upToCount: 256), !data.isEmpty {
                if let s = String(data: data, encoding: .utf8),
                   s.uppercased().contains("STOP")
                {
                    stopFlag.value = true
                    break
                }
            } else {
                Thread.sleep(forTimeInterval: 0.15)
            }
        }
    }

    while !stopFlag.value {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
        if !audioEngine.isRunning {
            break
        }
    }

    request.endAudio()
    audioEngine.stop()
    input.removeTap(onBus: 0)
    task.cancel()
    emit("END")
}

final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var _value = false
    var value: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _value }
        set { lock.lock(); _value = newValue; lock.unlock() }
    }
}

let lang = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ar-EG"

let micLock = DispatchSemaphore(value: 0)
var micGranted = false
AVCaptureDevice.requestAccess(for: .audio) { granted in
    micGranted = granted
    micLock.signal()
}
_ = micLock.wait(timeout: .now() + 120)
guard micGranted else {
    emit("AUTH", "microphone-denied")
    exit(2)
}

let authLock = DispatchSemaphore(value: 0)
var authStatus: SFSpeechRecognizerAuthorizationStatus = .notDetermined
SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authLock.signal()
}
_ = authLock.wait(timeout: .now() + 120)

switch authStatus {
case .authorized:
    emit("AUTH", "ok")
case .denied:
    emit("AUTH", "denied")
    exit(2)
case .restricted:
    emit("AUTH", "restricted")
    exit(2)
case .notDetermined:
    emit("AUTH", "notDetermined")
    exit(2)
@unknown default:
    emit("AUTH", "unknown")
    exit(2)
}

let primary = SFSpeechRecognizer(locale: Locale(identifier: lang))
let fallback = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
guard let recognizer = (primary?.isAvailable == true ? primary : nil)
        ?? (fallback?.isAvailable == true ? fallback : nil)
else {
    emit("ERROR", "Speech recognizer unavailable")
    exit(2)
}

runSession(recognizer: recognizer)
