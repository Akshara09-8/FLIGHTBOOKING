export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  data?: Record<string, string>;
};

export const EMPTY_FORM_STATE: FormState = {};
