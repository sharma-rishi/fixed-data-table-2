/**
 * Copyright Schrodinger, LLC
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule reducers
 */

'use strict';

import { getScrollAnchor, scrollTo } from 'scrollAnchor';
import * as ActionTypes from 'ActionTypes';
import IntegerBufferSet from 'IntegerBufferSet';
import PrefixIntervalTree from 'PrefixIntervalTree';
import columnStateHelper from 'columnStateHelper'
import columnWidths from 'columnWidths';
import computeRenderedColumns from 'computeRenderedColumns';
import computeRenderedRows from 'computeRenderedRows';
import getColumnData from 'convertColumnElementsToData';
import pick from 'lodash/pick';
import shallowEqual from 'shallowEqual';

/**
 * Returns the default initial state for the redux store.
 * This must be a brand new, independent object for each table instance
 * or issues may occur due to multiple tables sharing data.
 *
 * @return {!Object}
 */
function getInitialState() {
  return {
    /*
     * Input state set from props
     */
    columnProps: [],
    columnGroupProps: [],
    elementTemplates: {
      cell: [],
      footer: [],
      groupHeader: [],
      header: [],
    },
    elementHeights: {
      footerHeight: 0,
      groupHeaderHeight: 0,
      headerHeight: 0,
    },
    rowSettings: {
      bufferRowCount: undefined,
      rowHeight: 0,
      rowHeightGetter: () => 0,
      rowsCount: 0,
      subRowHeight: 0,
      subRowHeightGetter: () => 0,
    },
    scrollFlags: {
      overflowX: 'auto',
      overflowY: 'auto',
      showScrollbarX: true,
      showScrollbarY: true,
    },
    tableSize: {
      height: undefined,
      maxHeight: 0,
      ownerHeight: undefined,
      useMaxHeight: false,
      width: 0,
    },

    /*
     * Output state passed as props to the the rendered FixedDataTable
     * NOTE (jordan) rows may contain undefineds if we don't need all the buffer positions
     */
    columnOffsets: {},
    fixedColumnOffsets: {},
    fixedRightOffsets: {},
    columnsToRender: [],
    columnReorderingData: {},
    columnResizingData: {},
    firstColumnIndex: 0,
    firstColumnOffset: 0,
    firstRowIndex: 0,
    firstRowOffset: 0,
    isColumnReordering: false,
    isColumnResizing: false,
    maxScrollX: 0,
    maxScrollY: 0,
    rowOffsets: {},
    rows: [], // rowsToRender
    scrollContentHeight: 0,
    scrollX: 0,
    scrollY: 0,
    scrolling: false,

    /*
     * Internal state only used by this file
     * NOTE (jordan) internal state is altered in place
     * so don't trust it for redux history or immutability checks
     * TODO (jordan) investigate if we want to move this to local or scoped state
     */
    rowBufferSet: new IntegerBufferSet(),
    columnBufferSet: new IntegerBufferSet(),
    columnGroupBufferSet: new IntegerBufferSet(),
    storedHeights: [],
    rowOffsetIntervalTree: null, // PrefixIntervalTree
    columnOffsetIntervalTree: null, // PrefixIntervalTree
    columnGroupOffsetIntervalTree: null, // PrefixIntervalTree
  };
}

function reducers(state = getInitialState(), action) {
  switch (action.type) {
    case ActionTypes.INITIALIZE: {
      const { props } = action;

      let newState = setStateFromProps(state, props);
      newState = initializeRowHeightsAndOffsets(newState);
      newState = initializeColumnOffsets(newState);
      const scrollAnchor = getScrollAnchor(newState, props);
      newState = computeRenderedRows(newState, scrollAnchor);
      newState = columnStateHelper.initialize(newState, props, {});
      return computeRenderedColumns(newState, newState.columnAnchor);
    }
    case ActionTypes.PROP_CHANGE: {
      const { newProps, oldProps } = action;
      let newState = setStateFromProps(state, newProps);

      if (oldProps.rowsCount !== newProps.rowsCount ||
          oldProps.rowHeight !== newProps.rowHeight ||
          oldProps.subRowHeight !== newProps.subRowHeight) {
        newState = initializeRowHeightsAndOffsets(newState);
      }

      if (oldProps.rowsCount !== newProps.rowsCount) {
        // NOTE (jordan) bad practice to modify state directly, but okay since
        // we know setStateFromProps clones state internally
        newState.rowBufferSet = new IntegerBufferSet();
      }

      const scrollAnchor = getScrollAnchor(newState, newProps, oldProps);

      // If anything has changed in state, update our rendered rows
      if (!shallowEqual(state, newState) || scrollAnchor.changed) {
        newState = computeRenderedRows(newState, scrollAnchor);
      }

      newState = columnStateHelper.initialize(newState, newProps, oldProps);

      // if column anchor has changed, then update rendered columns
      if (!shallowEqual(state, newState) || newState.columnAnchor.changed) {
        newState = computeRenderedColumns(newState, newState.columnAnchor);
      }

      // if scroll values have changed, then we're scrolling!
      if (newState.scrollX !== state.scrollX || newState.scrollY !== state.scrollY) {
        newState.scrolling = newState.scrolling || true;
      }

      // TODO REDUX_MIGRATION solve w/ evil-diff
      // TODO (jordan) check if relevant props unchanged and
      // children column widths and flex widths are unchanged
      // alternatively shallow diff and reconcile props
      return newState;
    }
    case ActionTypes.SCROLL_END: {
      let newState = Object.assign({}, state, {
        scrolling: false,
      });
      const previousScrollAnchor = {
        firstIndex: state.firstRowIndex,
        firstOffset: state.firstRowOffset,
        lastIndex: state.lastIndex,
      };
      newState = computeRenderedRows(newState, previousScrollAnchor);
      newState = computeRenderedColumns(newState, newState.columnAnchor);
      return newState;
    }
    case ActionTypes.SCROLL_TO_Y: {
      let { scrollY } = action;
      const newState = Object.assign({}, state, {
        scrolling: true,
      });
      const scrollAnchor = scrollTo(newState, scrollY);
      return computeRenderedRows(newState, scrollAnchor);
    }
    case ActionTypes.COLUMN_RESIZE: {
      const { resizeData } = action;
      return columnStateHelper.resizeColumn(state, resizeData);
    }
    case ActionTypes.COLUMN_REORDER_START: {
      const { reorderData } = action;
      return columnStateHelper.reorderColumn(state, reorderData);
    }
    case ActionTypes.COLUMN_REORDER_END: {
      return Object.assign({}, state, {
        isColumnReordering: false,
        columnReorderingData: {}
      });
    }
    case ActionTypes.COLUMN_REORDER_MOVE: {
      const { deltaX } = action;
      return columnStateHelper.reorderColumnMove(state, deltaX);
    }
    case ActionTypes.SCROLL_TO_X: {
      const { scrollX } = action;
      const newState = Object.assign({}, state, {
        scrolling: true,
        scrollX,
      });
      newState.columnAnchor = columnStateHelper.scrollToPos(newState, scrollX);
      return computeRenderedColumns(newState, newState.columnAnchor);
    }
    default: {
      return state;
    }
  }
}

/**
 * Initialize row heights (storedHeights) & offsets based on the default rowHeight
 *
 * @param {!Object} state
 * @private
 */
function initializeRowHeightsAndOffsets(state) {
  const { rowHeight, rowsCount, subRowHeight } = state.rowSettings;
  const defaultFullRowHeight = rowHeight + subRowHeight;
  const rowOffsetIntervalTree = PrefixIntervalTree.uniform(rowsCount, defaultFullRowHeight);
  const scrollContentHeight = rowsCount * defaultFullRowHeight;
  const storedHeights = new Array(rowsCount);
  for (let idx = 0; idx < rowsCount; idx++) {
    storedHeights[idx] = defaultFullRowHeight;
  }
  return Object.assign({}, state, {
    rowOffsetIntervalTree,
    scrollContentHeight,
    storedHeights,
  });
}

/**
 * Initialize column offsets based on the given column props.
 *
 * @param {!Object} state
 * @private
 */
function initializeColumnOffsets(state) {
  const { scrollableColumns, scrollableColumnGroups } = columnWidths(state);
  const columnOffsetIntervalTree = new PrefixIntervalTree(scrollableColumns.map(column => column.width));
  const columnGroupOffsetIntervalTree = new PrefixIntervalTree(scrollableColumnGroups.map(column => column.width));

  return Object.assign({}, state, {
    columnOffsetIntervalTree,
    columnGroupOffsetIntervalTree,
  });
}

/**
 * @param {!Object} state
 * @param {!Object} props
 * @return {!Object}
 * @private
 */
function setStateFromProps(state, props) {
  // clone state
  const newState = Object.assign({}, state);

  // get column info from props
  const {
    columnGroupProps,
    columnProps,
    elementTemplates,
    useGroupHeader,
  } = getColumnData(props);

  // column and cell props/templates
  Object.assign(newState, { columnGroupProps, columnProps, elementTemplates });

  // element heights
  newState.elementHeights = Object.assign({}, newState.elementHeights,
    pick(props, ['cellGroupWrapperHeight', 'footerHeight', 'groupHeaderHeight', 'headerHeight']));
  if (!useGroupHeader) {
    newState.elementHeights.groupHeaderHeight = 0;
  }

  // row settings
  newState.rowSettings = Object.assign({}, newState.rowSettings,
    pick(props, ['bufferRowCount', 'rowHeight', 'rowsCount', 'subRowHeight']));
  const { rowHeight, subRowHeight } = newState.rowSettings;
  newState.rowSettings.rowHeightGetter =
    props.rowHeightGetter || (() => rowHeight);
  newState.rowSettings.subRowHeightGetter =
    props.subRowHeightGetter || (() => subRowHeight || 0);

  // scroll flags
  newState.scrollFlags = Object.assign({}, newState.scrollFlags,
    pick(props, ['overflowX', 'overflowY', 'showScrollbarX', 'showScrollbarY']));

  // table size
  newState.tableSize = Object.assign({}, newState.tableSize,
    pick(props, ['height', 'maxHeight', 'ownerHeight', 'width']));
  newState.tableSize.useMaxHeight =
    newState.tableSize.height === undefined;

  return newState;
}

module.exports = reducers;