// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import ChatContainer from "@/components/chat/ChatContainer";
import { Stack, Typography } from "@mui/material";
import React from "react";

export default function ChatPage(): React.JSX.Element {
    return (
        <Stack spacing={1} sx={{ flex: "1 1 auto", mt: 3 }}>
            <Typography variant="h4">Chat</Typography>
            <ChatContainer />
        </Stack>
    )
}