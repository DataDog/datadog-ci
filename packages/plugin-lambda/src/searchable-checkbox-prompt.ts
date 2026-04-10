import {loadCore} from '@datadog/datadog-ci-base/helpers/inquirer'
import chalk from 'chalk'
import {filter} from 'fuzzy'

const CURSOR_HIDE = '\u001B[?25l'

export type SearchableCheckboxConfig = {
  choices: string[]
  message: string
  pageSize: number
  validate: (selectedFunctionNames: readonly string[]) => boolean | string | Promise<boolean | string>
}

type SearchableChoice = {
  checked: boolean
  name: string
  short: string
  value: string
}

type SearchableCheckboxPrompt = (config: SearchableCheckboxConfig) => Promise<string[]>

let searchableCheckboxPromptPromise: Promise<SearchableCheckboxPrompt> | undefined

const getFilteredFunctionNames = (functionNames: string[], searchTerm?: string) => {
  if (!searchTerm) {
    return functionNames
  }

  return filter(searchTerm, functionNames).map((element) => element.original)
}

const createSearchableCheckboxPrompt = async (): Promise<SearchableCheckboxPrompt> => {
  const {
    createPrompt,
    isDownKey,
    isEnterKey,
    isSpaceKey,
    isUpKey,
    makeTheme,
    useEffect,
    useKeypress,
    useMemo,
    usePagination,
    usePrefix,
    useState,
  } = await loadCore()

  return createPrompt<string[], SearchableCheckboxConfig>((config, done) => {
    const theme = makeTheme(
      {
        icon: {
          checked: chalk.green('◉'),
          cursor: '❯',
          unchecked: '◯',
        },
        style: {
          answer: (text: string) => chalk.cyan(text),
          empty: (text: string) => chalk.dim(text),
          searchTerm: (text: string) => chalk.cyan(text),
        },
      },
      undefined
    )
    const [status, setStatus] = useState<'idle' | 'done'>('idle')
    const prefix = usePrefix({status, theme})
    const [searchTerm, setSearchTerm] = useState('')
    const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
    const [items, setItems] = useState<SearchableChoice[]>(
      config.choices.map((functionName) => ({
        checked: false,
        name: functionName,
        short: functionName,
        value: functionName,
      }))
    )
    const selectedItems = useMemo(() => items.filter((item) => item.checked), [items])
    const filteredItems = useMemo(() => {
      if (!searchTerm) {
        return items
      }

      const filteredNamesSet = new Set(
        getFilteredFunctionNames(
          items.map((item) => item.name),
          searchTerm
        )
      )

      return items.filter((item) => filteredNamesSet.has(item.name))
    }, [items, searchTerm])
    const [active, setActive] = useState(0)

    useEffect(() => {
      if (filteredItems.length === 0) {
        setActive(0)

        return
      }

      if (active >= filteredItems.length) {
        setActive(0)
      }
    }, [active, filteredItems.length])

    useKeypress(async (key, readline) => {
      if (isEnterKey(key)) {
        const selectedFunctions = selectedItems.map((item) => item.value)
        const isValid = await config.validate(selectedFunctions)

        if (isValid === true) {
          setStatus('done')
          done(selectedFunctions)

          return
        }

        readline.write(searchTerm)
        setErrorMessage(typeof isValid === 'string' ? isValid : 'You must choose at least one function.')

        return
      }

      if (filteredItems.length > 0 && (isUpKey(key) || isDownKey(key))) {
        readline.clearLine(0)
        readline.write(searchTerm)
        setErrorMessage(undefined)
        const offset = isUpKey(key) ? -1 : 1
        setActive((active + offset + filteredItems.length) % filteredItems.length)

        return
      }

      if (filteredItems.length > 0 && isSpaceKey(key)) {
        readline.clearLine(0)
        readline.write(searchTerm)
        setErrorMessage(undefined)
        const activeItem = filteredItems[active]

        if (!activeItem) {
          return
        }

        setItems(items.map((item) => (item.value === activeItem.value ? {...item, checked: !item.checked} : item)))

        return
      }

      setSearchTerm(readline.line)
      setErrorMessage(undefined)
    })

    const message = theme.style.message(config.message, status)
    const search = searchTerm ? ` ${theme.style.searchTerm(searchTerm)}` : ''

    if (status === 'done') {
      return [prefix, message, theme.style.answer(selectedItems.map((item) => item.short).join(', '))]
        .filter(Boolean)
        .join(' ')
    }

    const page =
      filteredItems.length === 0
        ? theme.style.empty('No results found')
        : usePagination({
            active,
            items: filteredItems,
            loop: false,
            pageSize: config.pageSize,
            renderItem: ({isActive, item}) => {
              const cursor = isActive ? theme.icon.cursor : ' '
              const checkbox = item.checked ? theme.icon.checked : theme.icon.unchecked
              const line = `${cursor}${checkbox} ${item.name}`

              return isActive ? theme.style.highlight(line) : line
            },
          })

    const body = [page, errorMessage ? theme.style.error(errorMessage) : undefined].filter(Boolean).join('\n')

    return [[[prefix, message, search].filter(Boolean).join(' ').trimEnd(), CURSOR_HIDE].join(''), body || undefined]
  })
}

export const loadSearchableCheckboxPrompt = async () => {
  searchableCheckboxPromptPromise ??= createSearchableCheckboxPrompt()

  return searchableCheckboxPromptPromise
}
