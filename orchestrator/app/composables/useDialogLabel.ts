import type { ModalProps } from '@nuxt/ui';

type DialogLabelContent = NonNullable<ModalProps['content']> & {
  'aria-labelledby': string;
  'aria-describedby': undefined;
};

/**
 * Names a UModal after the heading it renders in its own #content slot. Nuxt UI
 * only renders a DialogTitle / DialogDescription for the title / description
 * props, so Reka's default aria-labelledby / aria-describedby would point at
 * elements that don't exist and leave the dialog unnamed.
 *
 * Usage: `<UModal :content="content">` + `<h2 :id="titleId">`.
 */
export function useDialogLabel() {
  const titleId = useId();
  const content: DialogLabelContent = { 'aria-labelledby': titleId, 'aria-describedby': undefined };
  return { titleId, content };
}
