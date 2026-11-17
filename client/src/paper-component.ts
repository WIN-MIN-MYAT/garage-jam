import { createComponent, Types } from '@iwsdk/core';
export const PaperTask = createComponent('PaperTask', {
  taskId: { type: Types.String, default: '' },
  state: { type: Types.Enum, default: 'flat', enum: { flat: 'flat', crumpled: 'crumpled' } },
  completed: { type: Types.Boolean, default: false },
});
