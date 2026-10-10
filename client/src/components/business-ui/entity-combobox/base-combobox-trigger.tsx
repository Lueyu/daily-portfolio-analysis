'use client';

/**
 * The click trigger area of the combobox. Renders selected values as tags/badges
 * (with overflow "+N" tooltips) plus an "add" button, and supports button, search
 * and custom trigger modes.
 * Part of the vendored business-ui component library.
 */
import { Plus } from 'lucide-react';

import { useEntityComboboxContext } from '@client/src/components/business-ui/entity-combobox/context';
import { SearchTrigger } from '@client/src/components/business-ui/entity-combobox/search-trigger';
import {
  addButtonIconVariants,
  addButtonVariants,
  type ComboboxSize,
} from '@client/src/components/business-ui/entity-combobox/size-variants';
import type {
  ClassNamesConfig,
  ItemValue,
  TriggerRenderProps,
  TriggerType,
} from '@client/src/components/business-ui/entity-combobox/types';
import { cn } from '@/lib/utils';
import { Badge } from '@client/src/components/ui/badge';
import { Button } from '@client/src/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';

/** Props for BaseComboboxTrigger. */
export type BaseComboboxTriggerProps = {
  triggerType?: TriggerType;
  size?: ComboboxSize;
  placeholder?: string;
  renderTrigger?: (props: TriggerRenderProps) => React.ReactNode;
  maxTagCount?: number | 'responsive';
  maxTagTextLength?: number;
  tagClosable?: boolean;
  classNames?: ClassNamesConfig;
  onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLElement>) => void;
  renderTag?: (
    value: ItemValue,
    onClose: (value: ItemValue, e: React.MouseEvent) => void,
    disabled?: boolean,
  ) => React.ReactNode;
  /**
   * Returns whether a given option should be disabled.
   */
  getOptionDisabled?: (value: ItemValue) => boolean;
  /**
   * In button mode, a wrapper for the "+" button. Used to place the button inside
   * PopoverTrigger so the dropdown anchors to the button rather than the whole container.
   */
  renderAddButton?: (button: React.ReactNode) => React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
} & Omit<React.ComponentPropsWithoutRef<'button'>, 'children'>;

/** Renders the trigger area: selected tags plus the add/"+" button. */
export const BaseComboboxTrigger = ({
  triggerType = 'button',
  size = 'medium',
  placeholder = '请选择',
  renderTrigger,
  maxTagCount,
  maxTagTextLength,
  tagClosable = true,
  classNames,
  onFocus,
  onBlur,
  renderTag,
  getOptionDisabled,
  renderAddButton,
  ref,
  ...props
}: BaseComboboxTriggerProps) => {
  const {
    selectedValue,
    multiple,
    open,
    disabled,
    handleClear,
    handleDeselect,
  } = useEntityComboboxContext();

  // Custom render (custom trigger type)
  if (triggerType === 'custom' && renderTrigger) {
    return <>{renderTrigger({ selectedValue, multiple, open, disabled })}</>;
  }

  // search trigger type
  if (triggerType === 'search') {
    return (
      <SearchTrigger
        size={size}
        placeholder={placeholder}
        maxTagCount={maxTagCount}
        maxTagTextLength={maxTagTextLength}
        tagClosable={tagClosable}
        classNames={classNames}
        onFocus={onFocus as (e: React.FocusEvent<HTMLDivElement>) => void}
        onBlur={onBlur as (e: React.FocusEvent<HTMLDivElement>) => void}
        renderTag={renderTag}
        getOptionDisabled={getOptionDisabled}
      />
    );
  }

  // button trigger type (default)
  const hasValue = !multiple
    ? !!selectedValue
    : Array.isArray(selectedValue) && selectedValue.length > 0;

  // Maximum number of tags to display.
  const maxDisplayCount =
    typeof maxTagCount === 'number' ? maxTagCount : Infinity;

  // Number of tags hidden behind the "+N" overflow badge.
  const hiddenCount =
    multiple && Array.isArray(selectedValue) && typeof maxTagCount === 'number'
      ? Math.max(0, selectedValue.length - maxTagCount)
      : 0;

  const hiddenTags =
    multiple && Array.isArray(selectedValue) && typeof maxTagCount === 'number'
      ? selectedValue.slice(maxTagCount)
      : [];

  // Tag close callback
  const handleTagClose = (value: ItemValue, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the button click from firing
    // Disabled options cannot be closed
    if (getOptionDisabled?.(value)) return;
    if (!multiple) {
      handleClear(); // Single-select: clear the value
    } else {
      handleDeselect(value); // Multi-select: remove the given item
    }
  };

  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center gap-2',
        classNames?.trigger,
      )}
    >
      {/* Selected tags area */}
      {hasValue && (
        <>
          {!multiple && selectedValue ? (
            renderTag ? (
              renderTag(
                selectedValue as ItemValue,
                handleTagClose,
                getOptionDisabled?.(selectedValue as ItemValue),
              )
            ) : (
              <Badge
                variant="secondary"
                className={cn('h-7 text-xs', classNames?.tag)}
              >
                {(selectedValue as ItemValue).name}
              </Badge>
            )
          ) : multiple &&
            Array.isArray(selectedValue) &&
            selectedValue.length > 0 ? (
            <>
              {renderTag ? (
                <>
                  {selectedValue
                    .slice(0, maxDisplayCount)
                    .map((item) =>
                      renderTag(
                        item,
                        handleTagClose,
                        getOptionDisabled?.(item),
                      ),
                    )}
                  {hiddenCount > 0 && (
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'h-7 cursor-pointer text-xs',
                            classNames?.tag,
                          )}
                        >
                          +{hiddenCount}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent
                        className="w-auto max-w-80 p-2"
                        align="start"
                      >
                        <div className="flex flex-wrap gap-1">
                          {hiddenTags.map((item) =>
                            renderTag(
                              item,
                              handleTagClose,
                              getOptionDisabled?.(item),
                            ),
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              ) : (
                <>
                  {selectedValue.slice(0, maxDisplayCount).map((item) => (
                    <Badge
                      key={item.id}
                      variant="secondary"
                      className={cn('h-7 text-xs', classNames?.tag)}
                    >
                      {item.name}
                    </Badge>
                  ))}
                  {hiddenCount > 0 && (
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="secondary"
                          className={cn(
                            'h-7 cursor-pointer text-xs',
                            classNames?.tag,
                          )}
                        >
                          +{hiddenCount}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent
                        className="w-auto max-w-80 p-2"
                        align="start"
                      >
                        <div className="flex flex-wrap gap-1">
                          {hiddenTags.map((item) => (
                            <Badge
                              key={item.id}
                              variant="secondary"
                              className={cn('h-7 text-xs', classNames?.tag)}
                            >
                              {item.name}
                            </Badge>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </>
              )}
            </>
          ) : null}
        </>
      )}

      {/* "+" add button, placed right after the tags */}
      {(() => {
        const addButton = (
          <Button
            ref={ref}
            variant="secondary"
            size="icon"
            role="combobox"
            aria-expanded={open}
            data-state={open ? 'open' : 'closed'}
            aria-controls="combobox-content"
            disabled={disabled}
            className={addButtonVariants({ size })}
            onFocus={
              onFocus as (e: React.FocusEvent<HTMLButtonElement>) => void
            }
            onBlur={onBlur as (e: React.FocusEvent<HTMLButtonElement>) => void}
            {...props}
          >
            <Plus className={addButtonIconVariants({ size })} />
          </Button>
        );
        return renderAddButton ? renderAddButton(addButton) : addButton;
      })()}
    </div>
  );
};
