#include "WhatzItLiveOverlayOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return margelo::nitro::whatzit::liveoverlay::initialize(vm);
}
