// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Input, Popover, Slider, Stack, Typography } from "@mui/material";
import React from "react";

export default function MaxTokensPopover({ maxTokens, updateMaxTokens, open, anchorEl, handleClose }:
    {
        maxTokens: number, updateMaxTokens: (num: number) => void,
        open: boolean, anchorEl: HTMLDivElement | null, handleClose: VoidFunction
    }): React.JSX.Element {

    const min = 128
    const max = 4096
    const step = 1

    const handleChange = (event: Event, newValue: number | number[]): void => {
        updateMaxTokens(newValue as number);
    };

    const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        let value = event.target.value === '' ? 0 : Number(event.target.value)
        if (value < min) {
            value = min
        } else if (value > max) {
            value = max
        }
        updateMaxTokens(value);
    }

    const handleBlur = (): void => {
        if (maxTokens < min) {
            updateMaxTokens(min);
        } else if (maxTokens > max) {
            updateMaxTokens(max);
        }
    };

    return (
        <Popover
            id="maxTokens-popover"
            open={open}
            anchorEl={anchorEl}
            onClose={handleClose}
            anchorOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
        >
            <Stack sx={{ p: "1rem", minWidth: "250px", gap: ".5rem" }}>
                <Typography variant="body2" fontWeight="bold">Max Tokens</Typography>
                <Stack direction="row" alignItems="center" justifyContent="center" gap="1rem">
                    <Slider step={step} min={min} max={max} valueLabelDisplay="auto" aria-label="maxTokens" value={maxTokens} onChange={handleChange} />
                    <Input
                        value={maxTokens}
                        size="small"
                        onChange={handleTextChange}
                        onBlur={handleBlur}
                        inputProps={{
                            step,
                            min,
                            max,
                            type: 'number',
                            'aria-labelledby': 'input-slider',
                        }}
                    />
                </Stack>
            </Stack>
        </Popover>
    )
}