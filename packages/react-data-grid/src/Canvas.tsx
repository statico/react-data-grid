import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EventTypes } from './common/enums';
import { CalculatedColumn, CellMetaData, ColumnMetrics, InteractionMasksMetaData, Position, ScrollPosition } from './common/types';
import EventBus from './EventBus';
import InteractionMasks from './masks/InteractionMasks';
import { ReactDataGridProps } from './ReactDataGrid';
import Row from './Row';
import RowRenderer from './RowRenderer';
import SummaryRowRenderer from './SummaryRowRenderer';
import { getColumnScrollPosition, getScrollbarSize, isPositionStickySupported } from './utils';
import { getHorizontalRangeToRender, getVerticalRangeToRender } from './utils/viewportUtils';

type SharedDataGridProps<R, K extends keyof R> = Pick<ReactDataGridProps<R, K>,
| 'rowGetter'
| 'rowsCount'
| 'rowRenderer'
| 'rowGroupRenderer'
| 'scrollToRowIndex'
| 'contextMenu'
| 'RowsContainer'
| 'getSubRowDetails'
| 'selectedRows'
> & Required<Pick<ReactDataGridProps<R, K>,
| 'rowKey'
| 'enableCellSelect'
| 'rowHeight'
| 'cellNavigationMode'
| 'enableCellAutoFocus'
| 'editorPortalTarget'
| 'renderBatchSize'
>>;

export interface CanvasProps<R, K extends keyof R> extends SharedDataGridProps<R, K> {
  columnMetrics: ColumnMetrics<R>;
  cellMetaData: CellMetaData<R>;
  height: number;
  eventBus: EventBus;
  interactionMasksMetaData: InteractionMasksMetaData<R>;
  onScroll(position: ScrollPosition): void;
  summaryRows?: R[];
  onCanvasKeydown?(e: React.KeyboardEvent<HTMLDivElement>): void;
  onCanvasKeyup?(e: React.KeyboardEvent<HTMLDivElement>): void;
  onRowSelectionChange(rowIdx: number, row: R, checked: boolean, isShiftClick: boolean): void;
}

export default function Canvas<R, K extends keyof R>({
  cellMetaData,
  cellNavigationMode,
  columnMetrics,
  contextMenu,
  editorPortalTarget,
  enableCellAutoFocus,
  enableCellSelect,
  eventBus,
  getSubRowDetails,
  height,
  interactionMasksMetaData,
  onCanvasKeydown,
  onCanvasKeyup,
  onRowSelectionChange,
  onScroll,
  renderBatchSize,
  rowGetter,
  rowGroupRenderer,
  rowHeight,
  rowKey,
  rowRenderer,
  RowsContainer,
  rowsCount,
  scrollToRowIndex,
  selectedRows,
  summaryRows
}: CanvasProps<R, K>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const canvas = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const scrollBar = useRef<HTMLDivElement>(null);
  const interactionMasks = useRef<InteractionMasks<R, K>>(null);
  const prevScrollToRowIndex = useRef<number | undefined>();

  const [rowRefs] = useState(() => new Map<number, Row<R>>());
  const [summaryRowRefs] = useState(() => new Map<number, Row<R>>());

  const clientHeight = getClientHeight();

  const [rowOverscanStartIdx, rowOverscanEndIdx] = getVerticalRangeToRender(
    clientHeight,
    rowHeight,
    scrollTop,
    rowsCount,
    renderBatchSize
  );

  const { colOverscanStartIdx, colOverscanEndIdx, colVisibleStartIdx, colVisibleEndIdx } = useMemo(() => {
    return getHorizontalRangeToRender({
      columnMetrics,
      scrollLeft
    });
  }, [columnMetrics, scrollLeft]);

  const syncScroll = useCallback((newScrollLeft: number, isFromScrollBar = false) => {
    // scroll header rows
    onScroll({ scrollLeft: newScrollLeft, scrollTop });

    if (canvas.current) {
      canvas.current.scrollLeft = newScrollLeft;
    }
    if (summaryRef.current) {
      summaryRef.current.scrollLeft = newScrollLeft;
    }
    if (!isFromScrollBar && scrollBar.current) {
      scrollBar.current.scrollLeft = newScrollLeft;
    }
  }, [onScroll, scrollTop]);

  const scrollToColumn = useCallback((idx: number, columns: CalculatedColumn<R>[]) => {
    const { current } = canvas;
    if (!current) return;

    const { scrollLeft, clientWidth } = current;
    const newScrollLeft = getColumnScrollPosition(columns, idx, scrollLeft, clientWidth);
    if (newScrollLeft !== 0) {
      syncScroll(scrollLeft + newScrollLeft);
    }
  }, [syncScroll]);

  useEffect(() => {
    return eventBus.subscribe(EventTypes.SCROLL_TO_COLUMN, idx => scrollToColumn(idx, columnMetrics.columns));
  }, [columnMetrics.columns, eventBus, scrollToColumn]);

  useEffect(() => {
    if (prevScrollToRowIndex.current === scrollToRowIndex) return;
    prevScrollToRowIndex.current = scrollToRowIndex;
    const { current } = canvas;
    if (typeof scrollToRowIndex === 'number' && current) {
      current.scrollTop = scrollToRowIndex * rowHeight;
    }
  }, [rowHeight, scrollToRowIndex]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollTop: newScrollTop } = e.currentTarget;
    setScrollTop(newScrollTop);
    // to scroll headers
    onScroll({ scrollLeft, scrollTop: newScrollTop });
  }

  function setComponentsScrollLeft(scrollLeft: number) {
    if (isPositionStickySupported()) return;

    const { current } = interactionMasks;
    if (current) {
      current.setScrollLeft(scrollLeft);
    }

    [...rowRefs.values(), ...summaryRowRefs.values()].forEach(row => {
      if (row.setScrollLeft) {
        row.setScrollLeft(scrollLeft);
      }
    });
  }

  function handleHorizontalScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollLeft: newScrollLeft } = e.currentTarget;
    // Freeze columns on legacy browsers
    setComponentsScrollLeft(newScrollLeft);

    setScrollLeft(newScrollLeft);
    syncScroll(newScrollLeft, true);
  }

  function getClientHeight() {
    const scrollbarSize = columnMetrics.totalColumnWidth > columnMetrics.viewportWidth ? getScrollbarSize() : 0;
    const canvasHeight = summaryRows ? height - summaryRows.length * rowHeight - 2 : height;
    return canvasHeight - scrollbarSize - 1;
  }

  function onHitBottomCanvas({ rowIdx }: Position) {
    const { current } = canvas;
    if (current) {
      // We do not need to check for the index being in range, as the scrollTop setter will adequately clamp the value.
      current.scrollTop = (rowIdx + 1) * rowHeight - clientHeight;
    }
  }

  function onHitTopCanvas({ rowIdx }: Position) {
    const { current } = canvas;
    if (current) {
      current.scrollTop = rowIdx * rowHeight;
    }
  }

  function handleHitColummBoundary({ idx }: Position) {
    scrollToColumn(idx, columnMetrics.columns);
  }

  function getRowColumns(rowIdx: number) {
    const row = rowRefs.get(rowIdx);
    return row && row.props ? row.props.columns : columnMetrics.columns;
  }

  const setRowRef = useCallback((row: Row<R> | null, idx: number) => {
    if (row) {
      rowRefs.set(idx, row);
    } else {
      rowRefs.delete(idx);
    }
  }, [rowRefs]);

  const setSummaryRowRef = useCallback((row: Row<R> | null, idx: number) => {
    if (row) {
      summaryRowRefs.set(idx, row);
    } else {
      summaryRowRefs.delete(idx);
    }
  }, [summaryRowRefs]);

  function getViewportRows() {
    const rowElements = [];
    for (let idx = rowOverscanStartIdx; idx <= rowOverscanEndIdx; idx++) {
      const rowData = rowGetter(idx);
      rowElements.push(
        <RowRenderer<R, K>
          key={idx}
          idx={idx}
          rowData={rowData}
          setRowRef={setRowRef}
          cellMetaData={cellMetaData}
          colOverscanEndIdx={colOverscanEndIdx}
          colOverscanStartIdx={colOverscanStartIdx}
          columnMetrics={columnMetrics}
          eventBus={eventBus}
          getSubRowDetails={getSubRowDetails}
          onRowSelectionChange={onRowSelectionChange}
          rowGroupRenderer={rowGroupRenderer}
          rowHeight={rowHeight}
          rowKey={rowKey}
          rowRenderer={rowRenderer}
          scrollLeft={scrollLeft}
          selectedRows={selectedRows}
        />
      );
    }

    return rowElements;
  }

  const rowsContainerStyle: React.CSSProperties = { width: columnMetrics.totalColumnWidth };
  const canvasRowsContainerStyle: React.CSSProperties = {
    ...rowsContainerStyle,
    paddingTop: rowOverscanStartIdx * rowHeight,
    paddingBottom: (rowsCount - 1 - rowOverscanEndIdx) * rowHeight
  };
  const boundaryStyle: React.CSSProperties = { width: `calc(100% - ${getScrollbarSize() - 1}px)` };// 1 stands for 1px for border right

  let grid = (
    <div className="rdg-grid" style={canvasRowsContainerStyle}>
      {getViewportRows()}
    </div>
  );

  if (RowsContainer !== undefined) {
    grid = <RowsContainer id={contextMenu ? contextMenu.props.id : 'rowsContainer'}>{grid}</RowsContainer>;
  }

  let summary: JSX.Element | null = null;
  if (summaryRows && summaryRows.length) {
    summary = (
      <div className="rdg-summary">
        <div ref={summaryRef} style={boundaryStyle}>
          <div style={rowsContainerStyle}>
            {summaryRows.map((rowData: R, idx: number) => (
              <SummaryRowRenderer<R, K>
                key={idx}
                idx={idx}
                rowData={rowData}
                setRowRef={setSummaryRowRef}
                cellMetaData={cellMetaData}
                colOverscanEndIdx={colOverscanEndIdx}
                colOverscanStartIdx={colOverscanStartIdx}
                columnMetrics={columnMetrics}
                rowHeight={rowHeight}
                scrollLeft={scrollLeft}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="rdg-viewport"
        style={{ height: clientHeight }}
        ref={canvas}
        onScroll={handleScroll}
        onKeyDown={onCanvasKeydown}
        onKeyUp={onCanvasKeyup}
      >
        <InteractionMasks<R, K>
          ref={interactionMasks}
          rowGetter={rowGetter}
          rowsCount={rowsCount}
          rowHeight={rowHeight}
          columns={columnMetrics.columns}
          height={clientHeight}
          colVisibleStartIdx={colVisibleStartIdx}
          colVisibleEndIdx={colVisibleEndIdx}
          enableCellSelect={enableCellSelect}
          enableCellAutoFocus={enableCellAutoFocus}
          cellNavigationMode={cellNavigationMode}
          eventBus={eventBus}
          contextMenu={contextMenu}
          onHitBottomBoundary={onHitBottomCanvas}
          onHitTopBoundary={onHitTopCanvas}
          onHitLeftBoundary={handleHitColummBoundary}
          onHitRightBoundary={handleHitColummBoundary}
          scrollLeft={scrollLeft}
          scrollTop={scrollTop}
          getRowColumns={getRowColumns}
          editorPortalTarget={editorPortalTarget}
          {...interactionMasksMetaData}
        />
        {grid}
      </div>
      {summary}
      <div ref={scrollBar} className="rdg-horizontal-scroll-bar" onScroll={handleHorizontalScroll} style={boundaryStyle}>
        <div style={{ width: columnMetrics.totalColumnWidth }} />
      </div>
    </>
  );
}
