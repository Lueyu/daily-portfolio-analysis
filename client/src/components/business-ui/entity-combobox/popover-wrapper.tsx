'use client';

/**
 * PopoverWrapper: assembles the Radix Popover (trigger + dropdown content) for
 * the combobox. Renders the trigger and dropdown list, and adapts the PopoverTrigger
 * placement to the trigger type (button mode anchors the dropdown to the "+" button;
 * search/custom modes wrap the whole trigger).
 * Part of the vendored business-ui component library.
 */
import { BaseComboboxContent } from '@client/src/components/business-ui/entity-combobox/base-combobox-content';
import { BaseComboboxList } from '@client/src/components/business-ui/entity-combobox/base-combobox-list';
import { BaseComboboxSearch } from '@client/src/components/business-ui/entity-combobox/base-combobox-search';
import { BaseComboboxTrigger } from '@client/src/components/business-ui/entity-combobox/base-combobox-trigger';
import { useEntityComboboxContext } from '@client/src/components/business-ui/entity-combobox/context';
import type {
  ItemValue,
  PopoverWrapperProps,
} from '@client/src/components/business-ui/entity-combobox/types';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger } from '@client/src/components/ui/popover';

/**
 * Unified popover wrapper that renders the interaction mode according to triggerType.
 */
export function PopoverWrapper<
  T = unknown,
  TRaw = unknown,
  TValue extends ItemValue<TRaw> = ItemValue<TRaw>,
>(props: PopoverWrapperProps<T, TRaw, TValue>) {
  const {
    size,
    triggerType = 'button',
    renderTrigger,
    placeholder,
    maxTagCount,
    maxTagTextLength,
    tagClosable,
    className,
    classNames,
    placement,
    align,
    sideOffset,
    showSearch,
    searchPlaceholder,
    renderItem,
    renderTag,
    getItemValue,
    getOptionDisabled,
    emptyText,
    loadingText,
    onFocus,
    onBlur,
    slotProps,
    children,
  } = props;

  const { open, setOpen, disabled } = useEntityComboboxContext();

  // Track open state; a disabled combobox cannot be opened.
  const handleOpenChange = (newOpen: boolean) => {
    if (disabled && newOpen) return;
    setOpen(newOpen);
  };

  // Renders the dropdown content (search input + option list).
  const renderPopoverContent = () => (
    <BaseComboboxContent
      popoverProps={slotProps?.popover}
      className={classNames?.popover}
      side={placement}
      align={align}
      sideOffset={sideOffset}
    >
      {children || (
        <>
          {(showSearch || triggerType === 'search') && (
            <BaseComboboxSearch
              placeholder={searchPlaceholder}
              className={classNames?.search}
            />
          )}
          <BaseComboboxList
            renderItem={renderItem}
            getItemValue={getItemValue}
            getOptionDisabled={
              getOptionDisabled as ((value: ItemValue) => boolean) | undefined
            }
            emptyText={emptyText}
            loadingText={loadingText}
            classNames={classNames}
          />
        </>
      )}
    </BaseComboboxContent>
  );

  // button mode: tags render outside the popover; only the "+" button triggers it.
  if (triggerType === 'button') {
    return (
      <div className={cn(className, classNames?.root)}>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <BaseComboboxTrigger
            triggerType={triggerType}
            size={size}
            placeholder={placeholder}
            renderTrigger={renderTrigger as any}
            maxTagCount={maxTagCount}
            maxTagTextLength={maxTagTextLength}
            tagClosable={tagClosable}
            classNames={classNames}
            onFocus={onFocus}
            onBlur={onBlur}
            renderTag={renderTag as any}
            getOptionDisabled={
              getOptionDisabled as ((value: ItemValue) => boolean) | undefined
            }
            renderAddButton={(buttonProps) => (
              <PopoverTrigger asChild>{buttonProps}</PopoverTrigger>
            )}
          />
          {renderPopoverContent()}
        </Popover>
      </div>
    );
  }

  // search and custom modes: the whole trigger is wrapped by the Popover.
  return (
    <div className={cn(className, classNames?.root)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <div>
            <BaseComboboxTrigger
              triggerType={triggerType}
              size={size}
              placeholder={placeholder}
              renderTrigger={renderTrigger as any}
              maxTagCount={maxTagCount}
              maxTagTextLength={maxTagTextLength}
              tagClosable={tagClosable}
              classNames={classNames}
              onFocus={onFocus}
              onBlur={onBlur}
              renderTag={renderTag as any}
              getOptionDisabled={
                getOptionDisabled as ((value: ItemValue) => boolean) | undefined
              }
            />
          </div>
        </PopoverTrigger>
        {renderPopoverContent()}
      </Popover>
    </div>
  );
}
