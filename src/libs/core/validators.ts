import { DelayTuple, NumConstraints, StrConstraints } from "../types";
import { createError } from "./context";

export const V = {
  num: (
    constraints: NumConstraints,
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .Value }}",
    secondaryCheck?: { fn: (v: number) => boolean },
    secondaryErrorMsg?: string,
    secondaryErrorCode?: string,
    secondaryErrorPlaceholder?: string,
  ) =>
  (val: unknown) => {
    if (
      typeof val !== "number"
      || (!constraints.allowNaN && Number.isNaN(val))
    ) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (constraints.integer && !Number.isInteger(val)) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (constraints.isFloat && Number.isInteger(val)) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (constraints.min !== undefined && val < constraints.min) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (constraints.max !== undefined && val > constraints.max) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (
      constraints.minExclusive !== undefined
      && val <= constraints.minExclusive
    ) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (
      constraints.maxExclusive !== undefined
      && val >= constraints.maxExclusive
    ) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (
      secondaryCheck
      && secondaryErrorMsg
      && secondaryErrorCode
      && secondaryErrorPlaceholder
      && !secondaryCheck.fn(val)
    ) {
      throw createError(
        secondaryErrorMsg.replace(secondaryErrorPlaceholder, String(val)),
        { code: secondaryErrorCode },
      );
    }
  },
  str: (
    constraints: StrConstraints,
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .Value }}",
    secondaryCheck?: { fn: (v: string) => boolean },
    secondaryErrorMsg?: string,
    secondaryErrorCode?: string,
    secondaryErrorPlaceholder?: string,
  ) =>
  (val: unknown) => {
    if (typeof val !== "string") {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (constraints.notEmpty && val.trim() === "") {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
    if (
      secondaryCheck
      && secondaryErrorMsg
      && secondaryErrorCode
      && secondaryErrorPlaceholder
      && !secondaryCheck.fn(val)
    ) {
      throw createError(
        secondaryErrorMsg.replace(secondaryErrorPlaceholder, String(val)),
        { code: secondaryErrorCode },
      );
    }
  },
  bool: (
    constraints: { strictTrueFalse?: boolean } = {},
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .Value }}",
  ) =>
  (val: unknown) => {
    const isBoolean = typeof val === "boolean";
    const isStrict = constraints.strictTrueFalse;

    if (isStrict && !isBoolean) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }

    if (!isStrict && typeof val !== "boolean" && val !== 0 && val !== 1) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }
  },
  delay: (
    constraints: NumConstraints,
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .Value }}",
  ) =>
  (val: unknown) => {
    if (
      !Array.isArray(val)
      || val.length !== 2
      || val[0] !== true
      || typeof val[1] !== "number"
    ) {
      throw createError(errorMsg.replace(errorPlaceholder, String(val)), {
        code: errorCode,
      });
    }

    const numericValue = val[1];

    if (Number.isNaN(numericValue)) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
    if (!Number.isInteger(numericValue)) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
    if (constraints.min !== undefined && numericValue < constraints.min) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
    if (constraints.max !== undefined && numericValue > constraints.max) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
    if (constraints.minExclusive !== undefined && numericValue <= constraints.minExclusive) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
    if (constraints.maxExclusive !== undefined && numericValue >= constraints.maxExclusive) {
      throw createError(errorMsg.replace(errorPlaceholder, String(numericValue)), { code: errorCode });
    }
  },
  getValueFromArray: <T>(
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .OptionValue }}",
  ) =>
  (optionValue: unknown): T => {
    if (!Array.isArray(optionValue) || optionValue.length < 2) {
      throw createError(
        errorMsg.replace(errorPlaceholder, String(optionValue)),
        { code: errorCode },
      );
    }
    return optionValue[1] as T;
  },
  getDelaySeconds: (
    errorMsg: string,
    errorCode: string,
    errorPlaceholder = "{{ .Value }}",
  ) =>
  (value: unknown): DelayTuple => {
    let isProcessed = false;
    let numericValue: unknown = value;

    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "boolean") {
      [isProcessed, numericValue] = value;
    } else {
      throw createError(
        errorMsg.replace(errorPlaceholder, String(value)),
        { code: errorCode },
      );
    }

    if (isProcessed) {
      if (typeof numericValue !== "number") {
        throw createError(errorMsg.replace(errorPlaceholder, String(value)), {
          code: errorCode,
        });
      }
      return [true, numericValue];
    }

    const parsed = parseFloat(String(numericValue));
    const milliseconds = Math.round(parsed * 1000);
    return [true, milliseconds];
  },
};
