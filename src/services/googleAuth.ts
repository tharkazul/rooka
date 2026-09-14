let googleSigninModule: any = null;
let hasCheckedAvailability = false;
let isAvailable = false;

export function getGoogleSignin(): any {
  if (hasCheckedAvailability) {
    return isAvailable ? googleSigninModule : null;
  }

  hasCheckedAvailability = true;
  try {
    const mod = require('@react-native-google-signin/google-signin');
    if (mod && mod.GoogleSignin) {
      googleSigninModule = mod.GoogleSignin;
      isAvailable = true;
      return googleSigninModule;
    }
  } catch (err: any) {
    console.warn(
      '[@react-native-google-signin] Native module not found. Running in Expo Go or environment without native binary:',
      err?.message || err
    );
  }

  isAvailable = false;
  return null;
}

export function isGoogleAuthAvailable(): boolean {
  return !!getGoogleSignin();
}
