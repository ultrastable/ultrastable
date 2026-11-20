# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import pandas as pd

class AgentScoreboard:
    def __init__(self, data):
        self.data = pd.DataFrame(data)

    def get_per_agent_score(self):
        return self.data.groupby('agent')['score'].mean()

    def get_per_harness_score(self):
        return self.data.groupby('harness')['score'].mean()
