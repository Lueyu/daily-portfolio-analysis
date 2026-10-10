'use client';

/**
 * Form-level context: shares the global layout mode (vertical/responsive/horizontal)
 * from the Form provider down to individual fields.
 * Part of the vendored business-ui component library.
 */
import React from 'react';

/** Global form props shared via context. */
export interface FormGlobalProps {
  layout: 'vertical' | 'responsive' | 'horizontal';
}

export type FormContextType = FormGlobalProps | null;

export const FormContext = React.createContext<FormContextType>(null);

/** Reads the form context; throws when used outside a Form provider. */
export const useFormContext = () => {
  const context = React.useContext(FormContext);
  if (!context) {
    throw new Error('useFormContext must be used within a FormProvider');
  }
  return context as FormGlobalProps;
};

/** Provides the global form layout to descendant fields. */
export const FormProvider: React.FC<{
  layout: 'vertical' | 'responsive' | 'horizontal';
  children: React.ReactNode;
}> = ({ layout, children }) => {
  const value = React.useMemo(
    () => ({
      layout: layout,
    }),
    [layout],
  );

  return <FormContext.Provider value={value}>{children}</FormContext.Provider>;
};

/** Convenience accessor for the global form props. */
export const useFormGlobalProps = () => {
  const context = useFormContext();
  return context;
};
