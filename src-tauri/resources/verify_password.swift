/**
 * Verify the current user's device login password (no biometrics UI).
 * Password is read from stdin (never argv).
 * Prints VIGIL_AUTH=1 only on success.
 */
import Foundation
import OpenDirectory

let data = FileHandle.standardInput.readDataToEndOfFile()
guard let password = String(data: data, encoding: .utf8)?
    .trimmingCharacters(in: CharacterSet(charactersIn: "\r\n")),
    !password.isEmpty
else {
    fputs("empty password\n", stderr)
    print("VIGIL_AUTH=0")
    exit(1)
}

do {
    let session = ODSession.default()
    let node = try ODNode(session: session, type: ODNodeType(kODNodeTypeAuthentication))
    let record = try node.record(
        withRecordType: kODRecordTypeUsers,
        name: NSUserName(),
        attributes: nil
    )
    try record.verifyPassword(password)
    FileHandle.standardError.write(Data("[vigil-bio] password verify ok\n".utf8))
    print("VIGIL_AUTH=1")
    exit(0)
} catch {
    let msg = error.localizedDescription
    FileHandle.standardError.write(Data("[vigil-bio] password verify failed: \(msg)\n".utf8))
    fputs(msg + "\n", stderr)
    print("VIGIL_AUTH=0")
    exit(1)
}
