/**
 * Shared types for the form system: FieldLayout style/className maps, the
 * FieldLayout props, and the common props shared by all form field components.
 * Part of the vendored business-ui component library.
 */
import type { ReactNode } from 'react';

/** Inline styles keyed by layout region. */
export type FieldLayoutStyles = Record<
  'root' | 'label' | 'description' | 'error',
  React.CSSProperties
>;
/** Class names keyed by layout region. */
export type FieldLayoutClassNames = Record<
  'root' | 'label' | 'description' | 'error',
  string
>;

/** Props for the FieldLayout wrapper. */
export interface FieldLayoutProps {
  label?: ReactNode;
  placeholder?: string;
  description?: string | undefined;
  isInvalid?: boolean;
  errorMessage?: string;
  layout?: 'horizontal' | 'vertical' | 'responsive';
  name?: string;
  required?: boolean;
  classNames?: Partial<FieldLayoutClassNames>; // Custom class names
  styles?: Partial<FieldLayoutStyles>; // Inline styles
}

/** Props common to every form field component. */
export interface CommonFieldProps {
  label?: ReactNode;
  placeholder?: string;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  layout?: 'horizontal' | 'vertical' | 'responsive';
}
