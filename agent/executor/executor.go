package executor

import (
	"bytes"
	"encoding/json"
	"os/exec"
)

type Command struct {
	ID      string `json:"id"`
	Script  string `json:"script"`
	Timeout int    `json:"timeout,omitempty"`
}

type Result struct {
	ID      string `json:"id"`
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

func Run(cmd Command) *Result {
	res := &Result{ID: cmd.ID}

	c := exec.Command("bash", "-c", cmd.Script)
	var stdout, stderr bytes.Buffer
	c.Stdout = &stdout
	c.Stderr = &stderr

	if err := c.Run(); err != nil {
		res.Success = false
		res.Error = err.Error()
	} else {
		res.Success = true
	}
	res.Output = stdout.String()
	if stderr.Len() > 0 {
		if res.Error != "" {
			res.Error += "\n" + stderr.String()
		} else {
			res.Error = stderr.String()
		}
	}

	return res
}

func (r *Result) ToJSON() []byte {
	data, _ := json.Marshal(r)
	return data
}
