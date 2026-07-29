@echo off
"C:\\Users\\clawl\\AppData\\Local\\Android\\Sdk\\cmake\\3.22.1\\bin\\cmake.exe" ^
  "-HC:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android" ^
  "-DCMAKE_SYSTEM_NAME=Android" ^
  "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON" ^
  "-DCMAKE_SYSTEM_VERSION=24" ^
  "-DANDROID_PLATFORM=android-24" ^
  "-DANDROID_ABI=x86_64" ^
  "-DCMAKE_ANDROID_ARCH_ABI=x86_64" ^
  "-DANDROID_NDK=C:\\Users\\clawl\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006" ^
  "-DCMAKE_ANDROID_NDK=C:\\Users\\clawl\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006" ^
  "-DCMAKE_TOOLCHAIN_FILE=C:\\Users\\clawl\\AppData\\Local\\Android\\Sdk\\ndk\\27.1.12297006\\build\\cmake\\android.toolchain.cmake" ^
  "-DCMAKE_MAKE_PROGRAM=C:\\Users\\clawl\\AppData\\Local\\Android\\Sdk\\cmake\\3.22.1\\bin\\ninja.exe" ^
  "-DCMAKE_CXX_FLAGS=-frtti -fexceptions -Wall -Wextra -fstack-protector-all -O1 -g -O2" ^
  "-DCMAKE_LIBRARY_OUTPUT_DIRECTORY=C:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\build\\intermediates\\cxx\\Debug\\107114mx\\obj\\x86_64" ^
  "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=C:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\build\\intermediates\\cxx\\Debug\\107114mx\\obj\\x86_64" ^
  "-DCMAKE_BUILD_TYPE=Debug" ^
  "-DCMAKE_FIND_ROOT_PATH=C:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\.cxx\\Debug\\107114mx\\prefab\\x86_64\\prefab" ^
  "-BC:\\dev\\whatz-it\\modules\\whatz-it-live-overlay\\android\\.cxx\\Debug\\107114mx\\x86_64" ^
  -GNinja ^
  "-DANDROID_STL=c++_shared" ^
  "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"
