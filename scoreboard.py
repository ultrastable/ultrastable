class Scoreboard:
    def __init__(self):
        self.scores = {}

    def add_score(self, agent, harness, score):
        if agent not in self.scores:
            self.scores[agent] = {}
        self.scores[agent][harness] = score

    def get_score(self, agent, harness):
        return self.scores.get(agent, {}).get(harness, None)
