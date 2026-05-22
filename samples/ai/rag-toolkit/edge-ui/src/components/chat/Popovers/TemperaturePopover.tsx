// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Input, Popover, Slider, Stack, Typography } from "@mui/material";
import React from "react";

export default function TemperaturePopover({ temperature, updateTemperature, open, anchorEl, handleClose }:
    {
        temperature: number, updateTemperature: (temp: number) => void,
        open: boolean, anchorEl: HTMLDivElement | null, handleClose: VoidFunction
    }): React.JSX.Element {

    const min = 0.01
    const max = 1
    const step = 0.01

    const handleChange = (event: Event, newValue: number | number[]): void => {
        updateTemperature(newValue as number);
    };

    const handleTextChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        let value = event.target.value === '' ? 0 : Number(event.target.value)
        if (value < min) {
            value = min
        } else if (value > max) {
            value = max
        }
        updateTemperature(value);
    }

    const handleBlur = (): void => {
        if (temperature < min) {
            updateTemperature(min);
        } else if (temperature > max) {
            updateTemperature(max);
        }
    };

    return (
        <Popover
            id="temperature-popover"
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
                <Typography variant="body2" fontWeight="bold">Temperature</Typography>
                <Stack direction="row" alignItems="center" justifyContent="center" gap="1rem">
                    <Slider step={step} min={min} max={max} valueLabelDisplay="auto" aria-label="temperature" value={temperature} onChange={handleChange} />
                    <Input
                        value={temperature}
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