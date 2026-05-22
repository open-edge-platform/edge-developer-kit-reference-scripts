// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FormControlLabel, Popover, Slider, Stack, Switch, Typography } from "@mui/material";
import React, { useState } from "react";

export default function ConversationHistoryPopover({ count, updateCount, open, anchorEl, handleClose }:
    {
        count: number, updateCount: (temp: number) => void,
        open: boolean, anchorEl: HTMLDivElement | null, handleClose: VoidFunction
    }): React.JSX.Element {
    const [unlimited, setUnlimited] = useState(false)

    const handleChange = (event: Event, newValue: number | number[]): void => {
        updateCount(newValue as number);
    };

    const handleSwitchChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
        setUnlimited(event.target.checked);
        updateCount(-1);
    };

    return (
        <Popover
            id="history-popover"
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
            <Stack sx={{ p: "1rem", minWidth: "300px", gap: ".5rem" }}>
                <Typography variant="body2" fontWeight="bold">Set limited history messages</Typography>
                <Stack direction="row" alignItems="center" gap="1rem" justifyContent="space-between">
                    <Slider disabled={unlimited} step={1} min={0} max={30} valueLabelDisplay="auto" value={count} onChange={handleChange} />
                    <FormControlLabel control={<Switch checked={unlimited}
                        onChange={handleSwitchChange} />} label="Unlimited" />
                </Stack>
            </Stack>
        </Popover>
    )
}