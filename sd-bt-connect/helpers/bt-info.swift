import IOBluetooth
import Foundation

let devices = IOBluetoothDevice.pairedDevices() ?? []
var results: [[String: Any]] = []

for case let device as IOBluetoothDevice in devices {
    let name = device.name ?? "unknown"
    let addr = device.addressString ?? ""
    let connected = device.isConnected()

    var entry: [String: Any] = [
        "name": name,
        "address": addr,
        "connected": connected
    ]

    if connected {
        let obj = device as AnyObject
        // Try battery keys — Sony/most headphones use "batteryPercentSingle"
        // AirPods use Left/Right/Case, others use Combined
        for key in ["batteryPercentSingle", "batteryPercentCombined",
                     "batteryPercentLeft", "batteryPercentRight", "batteryPercentCase"] {
            if let val = obj.value(forKey: key) as? NSNumber {
                let pct = val.intValue
                if pct > 0 && pct <= 100 {
                    entry["battery"] = pct
                    break
                }
            }
        }
    }

    results.append(entry)
}

if let data = try? JSONSerialization.data(withJSONObject: results),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
