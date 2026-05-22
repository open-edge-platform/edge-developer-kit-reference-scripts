// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type LanguageProps } from "@/hooks/use-record-audio";
import { FormControl, Grid, MenuItem, Popover, Select, type SelectChangeEvent, Switch, Typography } from "@mui/material";
import React, { useEffect, useState } from "react";

export default function LanguagePopover({ languages, language, updateLanguage, open, anchorEl, handleClose, enableAudio, updateAudio }:
    {
        languages: { name: string, value: string }[], language: LanguageProps, updateLanguage: (selectedLanguage: LanguageProps) => void,
        open: boolean, anchorEl: HTMLDivElement | null, handleClose: VoidFunction,
        enableAudio: boolean, updateAudio: VoidFunction
    }): React.JSX.Element {
    const [init, setInit] = useState(true)
    const [spokenLanguage, setSpokenLanguage] = useState("english")
    const [outputLanguage, setOutputLanguage] = useState("english")

    const handleSpokenLanguageChange = (event: SelectChangeEvent): void => {
        setSpokenLanguage(event.target.value);
    };

    const handleOutputLanguageChange = (event: SelectChangeEvent): void => {
        setOutputLanguage(event.target.value);
    };

    useEffect(() => {
        let type = "translations"
        let selectedLanguage = spokenLanguage
        if (spokenLanguage === outputLanguage) {
            type = "transcriptions"
            selectedLanguage = outputLanguage
        }
        updateLanguage({ value: selectedLanguage, type } as LanguageProps)
    }, [spokenLanguage, outputLanguage, updateLanguage])

    useEffect(() => {
        if (init) {
            setInit(false)
            if (language.type === "transcriptions") {
                setSpokenLanguage(language.value)
            } else {
                setOutputLanguage(language.value)
            }
        }
    }, [init, language])


    return (
        <Popover
            id="language-popover"
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
            <Grid container rowGap="1rem" sx={{ p: "1rem" }}>
                <Grid item xs={5} sx={{ display: "flex", alignItems: "center" }}>
                    <Typography variant="body2" fontWeight="bold">Audio: </Typography>
                </Grid>
                <Grid item xs={7}>
                    <FormControl fullWidth>
                        <Switch checked={enableAudio} onChange={() => { updateAudio(); }} />
                    </FormControl>
                </Grid>
                <Grid item xs={5} sx={{ display: "flex", alignItems: "center" }}>
                    <Typography variant="body2" fontWeight="bold">Spoken Language: </Typography>
                </Grid>
                <Grid item xs={7}>
                    <FormControl fullWidth>
                        <Select
                            value={spokenLanguage}
                            onChange={handleSpokenLanguageChange}
                        >
                            {
                                languages.map(lang => {
                                    return (
                                        <MenuItem key={lang.value} value={lang.value}>{lang.name}</MenuItem>
                                    )
                                })
                            }
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={5} sx={{ display: "flex", alignItems: "center" }}>
                    <Typography variant="body2" fontWeight="bold">Output Language: </Typography>
                </Grid>
                <Grid item xs={7}>
                    <FormControl fullWidth>
                        <Select
                            value={outputLanguage}
                            onChange={handleOutputLanguageChange}
                        >
                            <MenuItem value="english">English</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>
            </Grid>
        </Popover>
    )
}