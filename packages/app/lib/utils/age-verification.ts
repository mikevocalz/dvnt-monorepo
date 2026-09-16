/** Date-of-birth validation for the 18+ admission rule. This is not identity verification. */

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
export function calculateAge(dob: Date | string, now = new Date()): number | null {
  let year: number, month: number, day: number;
  if (dob instanceof Date) {
    if (!Number.isFinite(dob.getTime())) return null;
    year = dob.getFullYear(); month = dob.getMonth() + 1; day = dob.getDate();
  } else if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    [year, month, day] = dob.split('-').map(Number);
  } else if (typeof dob === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dob)) {
    [month, day, year] = dob.split('/').map(Number);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || !Number.isFinite(now.getTime()) || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return now.getUTCFullYear() - year - Number(
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day),
  );
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

export function validateDateOfBirth(dob: Date | string, now = new Date()): AgeValidationResult {
  const age = calculateAge(dob, now);
  
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
