import Foundation
import AVFoundation

// Change the container to MOV without re-encoding the compressed video.
// Run on macOS with: swift scripts/to-mov.swift input.mp4 output.mov
guard CommandLine.arguments.count == 3 else {
    fputs("Usage: swift scripts/to-mov.swift input.mp4 output.mov\n", stderr)
    exit(1)
}
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard FileManager.default.fileExists(atPath: input.path),
      !FileManager.default.fileExists(atPath: output.path) else {
    fputs("Input must exist and output must not already exist.\n", stderr)
    exit(1)
}
let asset = AVURLAsset(url: input)
guard let exporter = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetPassthrough) else {
    fputs("Unable to create a passthrough exporter.\n", stderr)
    exit(1)
}
exporter.outputURL = output
exporter.outputFileType = .mov
exporter.shouldOptimizeForNetworkUse = true
let semaphore = DispatchSemaphore(value: 0)
exporter.exportAsynchronously { semaphore.signal() }
semaphore.wait()
guard exporter.status == .completed else {
    fputs("Export failed: \(String(describing: exporter.error))\n", stderr)
    exit(1)
}
print("Saved \(output.lastPathComponent) — MOV container, original video codec preserved.")
