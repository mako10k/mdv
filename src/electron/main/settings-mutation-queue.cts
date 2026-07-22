type SettingsMutationPlan<State, Value> = {
  nextState: State
  changed: boolean
  value: Value
}

type SettingsMutationResult<State, Value> = {
  settings: State
  changed: boolean
  value: Value
}

type SettingsMutationQueueOptions<State> = {
  getState: () => State
  persistState: (nextState: State) => Promise<void>
  commitState: (nextState: State) => void
}

function createSettingsMutationQueue<State>(options: SettingsMutationQueueOptions<State>) {
  let tail: Promise<void> = Promise.resolve()

  function enqueue<Value>(
    mutate: (currentState: State) => SettingsMutationPlan<State, Value>,
  ): Promise<SettingsMutationResult<State, Value>> {
    const operation = tail.then(async () => {
      const currentState = options.getState()
      const plan = mutate(currentState)

      if (!plan.changed) {
        return {
          settings: currentState,
          changed: false,
          value: plan.value,
        }
      }

      await options.persistState(plan.nextState)
      options.commitState(plan.nextState)

      return {
        settings: plan.nextState,
        changed: true,
        value: plan.value,
      }
    })

    tail = operation.then(
      () => undefined,
      () => undefined,
    )

    return operation
  }

  return { enqueue }
}

export {
  createSettingsMutationQueue,
  type SettingsMutationPlan,
  type SettingsMutationResult,
}
