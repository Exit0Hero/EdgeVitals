# Native camera: device test plan

The iOS/Android scan (`apps/mobile/src/camera/CameraScanner.tsx`) uses VisionCamera 5 frame output (YUV 4:2:0, ~480x640) and on-device ML Kit face detection (`react-native-vision-camera-face-detector`). Each frame is reduced to forehead/cheek colour averages on the frame-processor thread by `extractRoiYuv` (`packages/measurement/src/yuv.ts`). No frames, images or video are stored or sent.

**Status: not verified on a physical device.** Unit tests cover buffer rotation/mirroring, planar and interleaved chroma, full/video range conversion and timestamp units. They cannot confirm how each platform actually reports orientation, mirroring, plane layout and timestamps; that is what this plan checks. Native support must not be described as working until every "must pass" row passes on at least one recent iPhone and one Android phone.

## Build

`eas build --profile preview --platform ios|android` (needs an Expo account; iOS needs an Apple Developer account and the device registered), or `npx expo run:ios --device` / `npx expo run:android` on a machine with Xcode / Android Studio. The app needs a reachable API (`EXPO_PUBLIC_API_URL`).

## Record for each device

Device model, OS version, app commit, lighting (window daylight / indoor lamp / dim), skin tone (Fitzpatrick, self-reported, optional), glasses yes/no.

## Checks

| #   | Check                                                                                                                       | How                                                                                                                                                           | Must pass   |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | First-run permission prompt shows the usage text                                                                            | Fresh install, start a scan                                                                                                                                   | Yes         |
| 2   | Denying permission shows "Camera access is off" with Open settings and Try again; granting in Settings then Try again works | Deny, then allow in Settings                                                                                                                                  | Yes         |
| 3   | Preview is the front camera, upright, mirrored like a selfie                                                                | Look at the oval                                                                                                                                              | Yes         |
| 4   | Face found / lost guidance follows the face                                                                                 | Move in and out of the oval                                                                                                                                   | Yes         |
| 5   | ROI lands on forehead and cheeks, not background                                                                            | Debug build: log `roi.skinPixels` per frame; it should be several hundred with the face centred and ~0 with the camera pointed at a wall                      | Yes         |
| 6   | Heart rate agrees with a reference                                                                                          | Chest strap or finger pulse oximeter (record its make), sitting still, 3 scans; camera vs reference within 5 bpm, or the app withholds the value              | Yes         |
| 7   | Poor conditions are refused, not guessed                                                                                    | Dim room; head moving; backlit window. Expect quality guidance and "No reliable reading", never a number that disagrees with the reference by more than 5 bpm | Yes         |
| 8   | Backgrounding the app mid-scan stops the camera and shows "interrupted"; nothing is saved                                   | Home button during a scan                                                                                                                                     | Yes         |
| 9   | Incoming call / another app taking the camera shows the interruption message and Try again recovers                         | Call the phone during a scan                                                                                                                                  | Yes         |
| 10  | Frame rate is steady                                                                                                        | Debug build: frames per second over the scan ≥ 15                                                                                                             | Yes         |
| 11  | Landscape / rotated phone                                                                                                   | Rotate during the scan (app is portrait-locked); readings still come from the face                                                                            | No (record) |
| 12  | Battery and heat                                                                                                            | 5 back-to-back scans; note temperature and battery drop                                                                                                       | No (record) |

Record results in a copy of this table per device and attach it to the PR that claims native support.

## If check 5 fails

The likely cause is orientation or mirroring. `CameraScanner.tsx` assumes ML Kit reports boxes in the upright image, mirrored on iOS and not on Android. Log `frame.orientation`, `frame.isMirrored`, `frame.width/height` and the face's `frameWidth/frameHeight` and compare with `uprightToBuffer` in `yuv.ts`.
