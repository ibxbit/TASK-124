import { copyCell } from './clipboard.js';

export function buildRowContextMenu({ cellValue, row, onOpenOrder, onFlagAnomaly }) {
  return [
    { label: 'Copy cell', action: () => copyCell(cellValue) },
    { label: 'Open related order', disabled: !(row && row.orderId),
      action: () => onOpenOrder && onOpenOrder(row.orderId) },
    { label: 'Flag anomaly', action: () => onFlagAnomaly && onFlagAnomaly(row) }
  ];
}
