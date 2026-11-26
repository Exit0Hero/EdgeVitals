# Native camera: device test plan

The iOS/Android scan (`apps/mobile/src/camera/CameraScanner.tsx`) uses VisionCamera 5 frame output (YUV 4:2:0, ~480x640) and on-device ML Kit face detection (`react-native-vision-camera-face-detector`). Each frame is reduced to forehead/cheek colour averages on the frame-processor thread by `extractRoiYuv` (`packages/measurement/src/yuv.ts`). No frames, images or video are stored or sent.

**Status: not verified on a physical device.** Unit tests cover buffer rotation/mirroring, planar and interleaved chroma, full/video range conversion and timestamp units. They cannot confirm how each platform actually reports orientation, mirroring, plane layout and timestamps; that is what this plan checks. Native support must not be described as working until every "must pass" row passes on at least one recent iPhone and one Android phone.

## Build

**Cloud (chosen): EAS via GitHub Actions.**

1. One-time setup:
   - create an Expo account;
   - create an access token under Account settings › Access tokens;
   - add the token as the `EXPO_TOKEN` repository secret.
2. The test app needs a reachable **HTTPS staging API**. Deploy one first (see `docs/deployment.md`). The workflow writes its URL into the chosen EAS profile.
3. Run it from GitHub: Actions › **Build test app** › Run workflow. Pick the platform and profile, then paste the staging API URL. The first run creates the EAS project. After that, commit the `extra.eas.projectId` that `eas init` reports, so later runs reuse it.
4. Install the build on a phone:
   - **Android:** open the build's install link or QR code from expo.dev on the phone and allow installing the APK.
   - **iOS:** this needs an Apple Developer account. Run `npx eas-cli device:create` and open the link on each iPhone to register it. Then run `npx eas-cli credentials` once from a computer to set up ad-hoc signing (the workflow runs non-interactively and can't create credentials). Install from the build's link on the registered iPhone.

**Local alternative:** run `npx expo run:ios --device` or `npx expo run:android` on a machine with Xcode or Android Studio, with `EXPO_PUBLIC_API_URL` set.

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
