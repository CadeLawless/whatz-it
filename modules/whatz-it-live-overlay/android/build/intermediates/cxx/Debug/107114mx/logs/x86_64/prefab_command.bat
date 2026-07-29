@echo off
"C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java" ^
  --class-path ^
  "C:\\Users\\clawl\\.gradle\\caches\\modules-2\\files-2.1\\com.google.prefab\\cli\\2.1.0\\aa32fec809c44fa531f01dcfb739b5b3304d3050\\cli-2.1.0-all.jar" ^
  com.google.prefab.cli.AppKt ^
  --build-system ^
  cmake ^
  --platform ^
  android ^
  --abi ^
  x86_64 ^
  --os-version ^
  24 ^
  --stl ^
  c++_shared ^
  --ndk-version ^
  27 ^
  --output ^
  "C:\\Users\\clawl\\AppData\\Local\\Temp\\agp-prefab-staging4223324254294613294\\staged-cli-output" ^
  "C:\\Users\\clawl\\.gradle\\caches\\9.3.1\\transforms\\8095af3f7275e3442c04117f48c6211d\\workspace\\transformed\\react-android-0.86.0-debug\\prefab" ^
  "C:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\build\\intermediates\\cxx\\refs\\react-native-nitro-modules\\5r6w1436" ^
  "C:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\build\\intermediates\\cxx\\refs\\react-native-vision-camera\\3m1x543r" ^
  "C:\\Users\\clawl\\.gradle\\caches\\9.3.1\\transforms\\1c6305e84132ac2ca5701627d3a61fd1\\workspace\\transformed\\fbjni-0.7.0\\prefab"
