/**
 * Force OTA Check Debug Script
 * 
 * Add this temporarily to _layout.tsx to debug OTA delivery:
 * 
 * import { forceOTACheck } from '@/scripts/force-ota-check';
 * 
 * Then add button somewhere:
 * <Button onPress={forceOTACheck}>Force OTA Check</Button>
 */

import * as Updates from 'expo-updates';

export async function forceOTACheck() {
  console.log('=== FORCE OTA CHECK ===');
  
  try {
    // 1. Check if updates are enabled
    console.log('Updates enabled:', Updates.isEnabled);
    console.log('Updates channel:', Updates.channel);
    console.log('Updates runtime version:', Updates.runtimeVersion);
    console.log('Current update ID:', Updates.updateId);
    
    // 2. Check for updates
    console.log('Checking for updates...');
    const check = await Updates.checkForUpdateAsync();
    console.log('Update available:', check.isAvailable);
    console.log('Manifest:', check.manifest);
    
    if (check.isAvailable) {
      console.log('Downloading update...');
      const result = await Updates.fetchUpdateAsync();
      console.log('Update downloaded:', result.isNew);
      
      if (result.isNew) {
        console.log('Reloading app...');
        await Updates.reloadAsync();
      }
    } else {
      console.log('No updates available. Already on latest.');
      console.log('Expected update: 678b2753-fe88-4464-8a09-ed9569b1cf17');
    }
  } catch (error) {
    console.error('OTA check failed:', error);
  }
}
