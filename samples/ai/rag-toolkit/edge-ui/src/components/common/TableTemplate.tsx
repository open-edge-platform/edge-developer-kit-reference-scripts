// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React, { useMemo, useState } from 'react';
import { Delete } from '@mui/icons-material';
import {
  Checkbox,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
} from '@mui/material';
import { Box } from '@mui/system';
import { visuallyHidden } from '@mui/utils';

import { type TableHeaderProps, type TableProps } from '@/types/table';
import { sanitizeCellValue, isSafeReactElement } from '@/utils/sanitization';

function descendingComparator<T>(a: T, b: T, orderBy: keyof T): number {
  if (b[orderBy] < a[orderBy]) {
    return -1;
  }
  if (b[orderBy] > a[orderBy]) {
    return 1;
  }
  return 0;
}

type Order = 'asc' | 'desc';

function getComparator<Key extends keyof any>(
  order: Order,
  orderBy: Key
): (a: { [key in Key]: number | string }, b: { [key in Key]: number | string }) => number {
  return order === 'desc'
    ? (a, b) => descendingComparator(a, b, orderBy)
    : (a, b) => -descendingComparator(a, b, orderBy);
}

function stableSort<T>(array: readonly T[], comparator: (a: T, b: T) => number): T[] {
  const stabilizedThis = array.map((el, index) => [el, index] as [T, number]);
  stabilizedThis.sort((a, b) => {
    const order = comparator(a[0], b[0]);
    if (order !== 0) {
      return order;
    }
    return a[1] - b[1];
  });
  return stabilizedThis.map((el) => el[0]);
}

interface EnhancedTableHeadProps {
  headers: TableHeaderProps[];
  numSelected: number;
  onRequestSort: (event: React.MouseEvent<unknown>, property: string | number) => void;
  onSelectAllClick: (event: React.ChangeEvent<HTMLInputElement>) => void;
  order: Order;
  orderBy: string;
  rowCount: number;
  enableActions: boolean;
  handleDeleteSelected?: (ids: number[]) => void;
  selected: number[];
}

interface EnhancedTableDataProps {
  key: string;
  headers: TableHeaderProps[];
  data: Record<string, any>;
  handleClick: (event: React.MouseEvent<unknown>, id: number) => void;
  isItemSelected: boolean;
  index: number;
  labelId: string;
  enableActions: boolean;
  enableCheckbox: boolean;
  rowClicked?: (id: number | string) => void;
}

function EnhancedTableHead(props: EnhancedTableHeadProps): React.JSX.Element {
  const {
    enableActions,
    headers,
    onSelectAllClick,
    order,
    orderBy,
    numSelected,
    rowCount,
    onRequestSort,
    handleDeleteSelected,
    selected,
  } = props;
  const createSortHandler = (property: string | number) => (event: React.MouseEvent<unknown>) => {
    onRequestSort(event, property);
  };

  return (
    <TableHead>
      <TableRow>
        {handleDeleteSelected ? (
          <TableCell padding="checkbox">
            <Checkbox
              color="primary"
              indeterminate={numSelected > 0 && numSelected < rowCount}
              checked={rowCount > 0 && numSelected === rowCount}
              onChange={onSelectAllClick}
            />
          </TableCell>
        ) : null}
        {headers.map((headCell) => (
          <TableCell
            key={headCell.id}
            align={headCell.numeric ? 'right' : 'left'}
            padding="normal"
            sortDirection={orderBy === headCell.id ? order : false}
          >
            <TableSortLabel
              active={orderBy === headCell.id}
              direction={orderBy === headCell.id ? order : 'asc'}
              onClick={createSortHandler(headCell.id as string | number)}
            >
              {headCell.label}
              {orderBy === headCell.id ? (
                <Box component="span" sx={visuallyHidden}>
                  {order === 'desc' ? 'sorted descending' : 'sorted ascending'}
                </Box>
              ) : null}
            </TableSortLabel>
          </TableCell>
        ))}
        {enableActions ? (
          <TableCell align="center">
            {handleDeleteSelected && numSelected > 0 ? (
              <IconButton
                color="error"
                onClick={() => {
                  handleDeleteSelected(selected);
                }}
              >
                <Delete sx={{ fontSize: '1.5rem' }} />
              </IconButton>
            ) : (
              'Action'
            )}
          </TableCell>
        ) : null}
      </TableRow>
    </TableHead>
  );
}

function EnhancedTableData(props: EnhancedTableDataProps): React.JSX.Element {
  const { headers, data, handleClick, isItemSelected, index, labelId, enableActions, enableCheckbox, rowClicked } =
    props;
  return (
    <TableRow
      hover={enableCheckbox}
      onClick={(event: React.MouseEvent<unknown>) => {
        if (rowClicked) rowClicked(data.id as number | string);
        if (enableCheckbox) handleClick(event, data.id as number);
      }}
      role="checkbox"
      aria-checked={isItemSelected}
      tabIndex={-1}
      selected={isItemSelected}
      sx={{
        '&:hover': {
          backgroundColor: enableCheckbox || rowClicked ? '#F1F1F1' : '',
          cursor: enableCheckbox || rowClicked ? 'pointer' : 'default',
        },
        ...(data.styles ?? {}),
      }}
    >
      {enableCheckbox ? (
        <TableCell padding="checkbox">
          <Checkbox
            color="primary"
            checked={isItemSelected}
            inputProps={{
              'aria-labelledby': labelId,
            }}
          />
        </TableCell>
      ) : null}

      {/*
        SECURITY: Enhanced sanitization using sanitizeCellValue to prevent XSS attacks.
        This addresses CID 2372868: DOM-based cross-site scripting (DOM_XSS)
        Only primitive values (string, number, boolean) are rendered after sanitization.
      */}
      {headers.map((header, idx) => {
        const safeValue = sanitizeCellValue(data[header.id]);
        return <TableCell key={`Cell_${index}_${idx}`}>{safeValue}</TableCell>;
      })}
      {enableActions ? (
        <TableCell align="center">
          {/*
            SECURITY: Enhanced validation using isSafeReactElement to prevent XSS via untrusted React elements.
            This addresses CID 2372868: DOM-based cross-site scripting (DOM_XSS)
          */}
          {isSafeReactElement(data.actions) ? data.actions : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

export default function TableTemplate({
  headers = [],
  data = [],
  enableActions = false,
  handleDeleteSelected,
  rowClicked,
  enablePagination = false, //this is only enabled if all data are passed without pagination on server side
}: Omit<TableProps, 'data'> & { data?: Record<string, any>[] }): React.JSX.Element {
  const [order, setOrder] = useState<Order>('asc');
  const [orderBy, setOrderBy] = useState<string>('id');
  const [selected, setSelected] = useState<number[]>([]);

  //Pagination states
  const rowOptions = [5, 10, 50, 100];
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(rowOptions[0]);

  const handleRequestSort = (event: React.MouseEvent<unknown>, property: string | number): void => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property as string);
  };

  const handleSelectAllClick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    if (event.target.checked) {
      if (selected.length > 0) {
        setSelected([]);
      } else {
        const newSelected = data.map((d: Record<string, any>) => d.id as number);
        setSelected(newSelected);
        return;
      }
    }
    setSelected([]);
  };

  const handleClick = (event: React.MouseEvent<unknown>, id: number): void => {
    const selectedIndex = selected.indexOf(id);
    let newSelected: number[] = [];

    if (selectedIndex === -1) {
      newSelected = newSelected.concat(selected, id);
    } else if (selectedIndex === 0) {
      newSelected = newSelected.concat(selected.slice(1));
    } else if (selectedIndex === selected.length - 1) {
      newSelected = newSelected.concat(selected.slice(0, -1));
    } else if (selectedIndex > 0) {
      newSelected = newSelected.concat(selected.slice(0, selectedIndex), selected.slice(selectedIndex + 1));
    }
    setSelected(newSelected);
  };

  const isSelected = (id: number): boolean => {
    return selected.includes(id);
  };

  const sortedData = useMemo(() => stableSort(data, getComparator(order, orderBy)), [data, order, orderBy]);
  const filteredData = useMemo(() => {
    if (enablePagination) {
      const index = (page - 1) * rowsPerPage;
      return sortedData.slice(index, index + rowsPerPage);
    }
    return sortedData;
  }, [enablePagination, sortedData, page, rowsPerPage]);

  return (
    <Stack sx={{ width: '100%' }}>
      <Paper sx={{ width: '100%', mb: 2 }}>
        <TableContainer>
          <Table sx={{ minWidth: 750 }} aria-labelledby="tableTitle" size="medium">
            <EnhancedTableHead
              enableActions={enableActions}
              headers={headers}
              numSelected={selected.length}
              order={order}
              orderBy={orderBy}
              onSelectAllClick={handleSelectAllClick}
              onRequestSort={(e, property) => {
                handleRequestSort(e, property);
              }}
              rowCount={data.length}
              handleDeleteSelected={handleDeleteSelected}
              selected={selected}
            />
            <TableBody>
              {filteredData.length > 0 ? (
                filteredData.map((d: Record<string, any>, index: number) => {
                  const isItemSelected = isSelected(d.id as number);
                  const labelId = `enhanced-table-checkbox-${index}`;

                  return (
                    <EnhancedTableData
                      key={`Row_${index}`}
                      index={index}
                      headers={headers}
                      data={d}
                      isItemSelected={isItemSelected}
                      labelId={labelId}
                      handleClick={handleClick}
                      rowClicked={rowClicked}
                      enableActions={enableActions}
                      enableCheckbox={handleDeleteSelected !== undefined}
                    />
                  );
                })
              ) : (
                <TableRow>
                  <TableCell align="center" colSpan={headers.length + (enableActions ? 2 : 1)}>
                    No Data Found...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      {enablePagination ? (
        <TablePagination
          rowsPerPageOptions={rowOptions}
          component="div"
          count={data.length}
          rowsPerPage={rowsPerPage}
          page={page - 1}
          onPageChange={(_: React.MouseEvent<HTMLButtonElement> | null, pageNumber: number) => {
            setPage(pageNumber + 1);
          }}
          onRowsPerPageChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setPage(1);
            setRowsPerPage(Number(e.target.value));
          }}
        />
      ) : null}
    </Stack>
  );
}
