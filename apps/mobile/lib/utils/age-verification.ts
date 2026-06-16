/**
 * Age Verification Utility
 * 
 * CRITICAL: This module enforces strict 18+ age verification.
 * NO EXCEPTIONS - users under 18 are permanently blocked.
 * 
 * Earliest allowed birth year: 2008 (as of 2026)
 * 
 * This is a compliance-critical module. DO NOT modify age limits.
 */

// Minimum age required to use the platform
export const MINIMUM_AGE = 18;

// Earliest allowed birth year (dynamically calculated)
export function getEarliestAllowedBirthYear(): number {
  const currentYear = new Date().getFullYear();
  return currentYear - MINIMUM_AGE;
}

// Static earliest year for UI pickers (2008 as of 2026)
export const EARLIEST_ALLOWED_BIRTH_YEAR = getEarliestAllowedBirthYear();

/**
 * Calculate age from date of birth
 * @param dob - Date of birth as Date object or string (YYYY-MM-DD, MM/DD/YYYY, etc.)
 * @returns Age in years, or null if invalid
 */
export function calculateAge(dob: Date | string): number | null {
  try {
    let birthDate: Date;
    
    if (typeof dob === 'string') {
      // Handle multiple date formats
      const cleanDob = dob.trim();
      
      // Try YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDob)) {
        const [year, month, day] = cleanDob.split('-').map(Number);
        birthDate = new Date(year, month - 1, day);
      }
      // Try MM/DD/YYYY format
      else if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleanDob)) {
        const [month, day, year] = cleanDob.split('/').map(Number);
        birthDate = new Date(year, month - 1, day);
      }
      // Try generic parsing as fallback
      else {
        birthDate = new Date(cleanDob);
      }
    } else {
      birthDate = dob;
    }
    
    // Validate the date
    if (isNaN(birthDate.getTime())) {
      console.error('[AgeVerification] Invalid date:', dob);
      return null;
    }
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    // Adjust age if birthday hasn't occurred yet this year
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  } catch (error) {
    console.error('[AgeVerification] Error calculating age:', error);
    return null;
  }
}

/**
 * Check if user is 18 or older
 * @param dob - Date of birth
 * @returns true if 18+, false if under 18, null if invalid
 */
export function isOver18(dob: Date | string): boolean | null {
  const age = calculateAge(dob);
  if (age === null) return null;
  return age >= MINIMUM_AGE;
}

/**
 * Validate birth year for UI pickers
 * @param year - Birth year
 * @returns true if year is allowed (user would be 18+)
 */
export function isValidBirthYear(year: number): boolean {
  const earliestYear = getEarliestAllowedBirthYear();
  return year <= earliestYear;
}

/**
 * Get maximum allowed date for date pickers (18 years ago from today)
 * Users must be AT LEAST 18, so max date is 18 years ago
 */
export function getMaximumBirthDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - MINIMUM_AGE);
  return date;
}

/**
 * Get minimum allowed date for date pickers (reasonable max age, e.g., 120 years)
 */
export function getMinimumBirthDate(): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 120);
  return date;
}

/**
 * Validate date of birth for signup
 * Returns validation result with error message if invalid
 */
export interface AgeValidationResult {
  isValid: boolean;
  isOver18: boolean | null;
  age: number | null;
  errorMessage: string | null;
}

export function validateDateOfBirth(dob: Date | string): AgeValidationResult {
  const age = calculateAge(dob);
  
  if (age === null) {
    return {
      isValid: false,
      isOver18: null,
      age: null,
      errorMessage: 'Invalid date of birth format.',
    };
  }
  
  if (age < 0) {
    return {
      isValid: false,
      isOver18: false,
      age,
      errorMessage: 'Date of birth cannot be in the future.',
    };
  }
  
  if (age < MINIMUM_AGE) {
    return {
      isValid: false,
      isOver18: false,
      age,
      errorMessage: `You must be ${MINIMUM_AGE} or older to use this platform.`,
    };
  }
  
  if (age > 120) {
    return {
      isValid: false,
      isOver18: null,
      age,
      errorMessage: 'Please enter a valid date of birth.',
    };
  }
  
  return {
    isValid: true,
    isOver18: true,
    age,
    errorMessage: null,
  };
}

/**
 * Error message for underage users
 */
export const UNDERAGE_ERROR_MESSAGE = 'You must be 18 or older to use this platform.';

/**
 * Error message for age verification failure
 */
export const AGE_VERIFICATION_FAILED_MESSAGE = 'Age verification failed. You must be 18 or older to access this platform.';
