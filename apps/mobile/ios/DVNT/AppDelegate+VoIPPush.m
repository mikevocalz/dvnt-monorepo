//
// AppDelegate+VoIPPush.m
// VoIP Push Notification handler via PushKit
//
// CRITICAL: On iOS 13+, every VoIP push MUST immediately report to CallKit.
// Failure to do so causes Apple to terminate the app and revoke VoIP push delivery.
//

#import <objc/runtime.h>
#import <PushKit/PushKit.h>
#import "DVNT-Swift.h"
#import "RNVoipPushNotificationManager.h"
#import "RNCallKeep.h"

@interface AppDelegate (VoIPPush) <PKPushRegistryDelegate>
@end

static PKPushRegistry *_voipRegistry = nil;

@implementation AppDelegate (VoIPPush)

// Called on app launch — register for VoIP push tokens
// We use +load to ensure this runs before didFinishLaunching
+ (void)load {
  // Schedule VoIP registration on the main queue after app finishes launching
  [[NSNotificationCenter defaultCenter]
    addObserverForName:UIApplicationDidFinishLaunchingNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *note) {
      _voipRegistry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
      _voipRegistry.delegate = (id<PKPushRegistryDelegate>)[UIApplication sharedApplication].delegate;
      _voipRegistry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
    }];
}

#pragma mark - PKPushRegistryDelegate

- (void)pushRegistry:(PKPushRegistry *)registry
  didUpdatePushCredentials:(PKPushCredentials *)credentials
  forType:(PKPushType)type
{
  // Forward VoIP device token to JS via react-native-voip-push-notification
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry
  didReceiveIncomingPushWithPayload:(PKPushPayload *)payload
  forType:(PKPushType)type
  withCompletionHandler:(void (^)(void))completion
{
  // Extract call data from VoIP push payload
  NSString *uuid = [[NSUUID UUID] UUIDString];
  NSDictionary *payloadDict = payload.dictionaryPayload;
  NSString *callerName = payloadDict[@"callerName"] ?: @"Unknown";
  NSString *handle = payloadDict[@"handle"] ?: @"Unknown";
  BOOL hasVideo = [payloadDict[@"hasVideo"] boolValue];

  // CRITICAL: Report to CallKit IMMEDIATELY (Apple iOS 13+ requirement)
  // This shows the native full-screen incoming call UI even when app is killed.
  [RNCallKeep reportNewIncomingCall:uuid
                             handle:handle
                         handleType:@"generic"
                           hasVideo:hasVideo
                localizedCallerName:callerName
                    supportsHolding:YES
                       supportsDTMF:YES
                   supportsGrouping:YES
                 supportsUngrouping:YES
                        fromPushKit:YES
                            payload:payloadDict
              withCompletionHandler:nil];

  // Store completion handler so react-native-voip-push-notification can call it
  [RNVoipPushNotificationManager addCompletionHandler:uuid completionHandler:completion];

  // Forward to JS side for additional handling
  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:(NSString *)type];
}

- (void)pushRegistry:(PKPushRegistry *)registry
  didInvalidatePushTokenForType:(PKPushType)type
{
  // Token invalidated — JS side will handle re-registration
}

@end
