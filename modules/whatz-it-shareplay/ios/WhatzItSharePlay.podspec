Pod::Spec.new do |s|
  s.name           = 'WhatzItSharePlay'
  s.version        = '1.0.0'
  s.summary        = 'WHATZ IT SharePlay session transport'
  s.description    = 'Apple GroupActivities bridge for remote WHATZ IT sessions.'
  s.author         = 'WHATZ IT'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.frameworks = 'GroupActivities'

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
