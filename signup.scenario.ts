import { Conversation } from '@grammyjs/conversations'
import { MyContext } from '../index'
import { InlineKeyboard } from 'grammy'
import { PhotoSize } from '@grammyjs/types'
import { SignupProfileDto } from '../../types/signup-profile.dto'
import { locationRepository, userRepository } from '../../prisma'
import { LocationDto } from '../../types/location.dto'
import { mainMenu } from '../menus/main.menu'

type SignupConversation = Conversation<MyContext>

export async function signup(
    conversation: SignupConversation,
    ctx: MyContext,
): Promise<void> {
    if (ctx.session.user) {
        await ctx.reply('Вы уже зарегистрированы', {
            reply_markup: {
                keyboard: mainMenu,
            },
        })
        return
    }
    const controller = new SignupController(conversation)
    const profile = await controller.signup(ctx)
    if (profile) {
        await userRepository.save(profile)
        await ctx.reply(
            'Готово! 👍\n' +
                'К твоему профилю Telegram теперь привязана анкета not.space 👍🏻 \n\n' +
                'Дальше – пара инструкций по пользованию сервисом, и можно выбирать мероприятия и знакомиться с классными людьми!',
        )
        await ctx.reply(
            '🦦 Сейчас твоя анкета заполнена на 15%.\n\n' +
                'Выдели минутку и заполни её до конца – как ты сможешь получать точные совпадение и быстрее заведёшь полезные/приятные знакомства' +
                ` в городе ${profile.location.city}.`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Перейти к заполнению профиля',
                                url: 'https://ya.ru', //TODO add link
                            },
                        ],
                    ],
                },
            },
        )
        await ctx.reply(
            'А теперь о навигации:\n\n' +
                '🙂Чтобы увидеть профили других пользователей и познакомиться, нажми кнопку «Новые люди»\n\n' +
                '💚Посмотреть, с кем случился взаимный интерес можно по кнопке «Взаимные»\n\n' +
                '👤Ты всегда можешь отредактировать свою анкету, нажав «Мой профиль»\n\n' +
                '⭐️Команда not.space всегда на связи по клику на кнопку «Поддержка»\n\n' +
                '💡 Подсказка: чтобы не потерять нас, закрепи бота в списке чатов.',
            { reply_markup: { keyboard: mainMenu } },
        )
    }
    return
}

class SignupController {
    constructor(private readonly conversation: SignupConversation) {}

    async signup(ctx: MyContext): Promise<SignupProfileDto | undefined> {
        if (ctx.from === undefined) {
            return undefined
        }
        const profile = new SignupProfileDto()
        profile.tgId = ctx.from.id
        profile.tgUsername = ctx.from.username ?? 'no name'
        profile.location = await this.getLocation(ctx)

        await ctx.reply(
            'Супер! Первая подборка для тебя уже готова 😍\n\n' +
                'Заверши регистрацию, чтобы получить её 👇🏻',
        )

        profile.fullName = await this.getName(ctx)
        profile.birthday = await this.getBirthday(ctx)
        profile.avatarFileId = await this.getAvatarFileId(ctx)
        // profile.phone = await this.getPhone(ctx)
        return profile
    }

    private async getName(ctx: MyContext): Promise<string> {
        await ctx.reply(
            'Как к тебе обращаться? Указывай реальные имя и фамилию ✨\n\n' +
                '<i>Продолжая, вы соглашаетесь с <a href="#">политикой конфиденциальности.</a></i>', //TODO add link
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Взять из профиля Telegram',
                                callback_data: 'from_tg',
                            },
                        ],
                    ],
                },
            },
        )
        const answer = await this.conversation.wait()
        if (answer.message?.text) {
            return answer.message.text
        } else if (answer.callbackQuery?.data === 'from_tg') {
            return `${answer.from?.first_name} ${answer.from?.last_name}`
        } else {
            return await this.getName(ctx)
        }
    }

    private async getAvatarFileId(
        ctx: MyContext,
        showButton = true,
    ): Promise<any> {
        const useTgAvatarCallbackQuery = 'signup:use_tg_avatar'
        await ctx.reply(
            'Пришли 1 твое фото\n' + 'Его будут видеть другие гости',
            {
                reply_markup: showButton
                    ? new InlineKeyboard().text(
                          'Взять из профиля Telegram',
                          useTgAvatarCallbackQuery,
                      )
                    : undefined,
            },
        )
        const avatarCtx = await this.conversation.wait()
        if (avatarCtx.message?.photo) {
            return this.getBestPhoto(avatarCtx.message.photo)
        } else if (avatarCtx.callbackQuery?.data === useTgAvatarCallbackQuery) {
            const photos = await ctx.getUserProfilePhotos()
            if (photos.total_count > 0) {
                return this.getBestPhoto(photos.photos[0])
            } else {
                await ctx.reply('Не удалось получить фото из профиля Telegram')
                return await this.getAvatarFileId(ctx, false)
            }
        } else {
            return await this.getAvatarFileId(ctx, showButton)
        }
    }

    private getBestPhoto(photos: PhotoSize[]): string {
        return photos.sort((p1, p2) => p2.width - p1.width)[0].file_id
    }

    // private async getPhone(ctx: MyContext): Promise<any> {
    //     await ctx.reply('Укажи свой номер телефона', {
    //         reply_markup: new Keyboard()
    //             .requestContact('Указать телефон')
    //             .resized(),
    //     })
    //     const { message } = await this.conversation.waitFor('message:contact')
    //     const phone = message.contact?.phone_number
    //     return phone && message.contact.user_id === ctx.from?.id
    //         ? phone
    //         : await this.getPhone(ctx)
    // }

    private async getLocation(ctx: MyContext): Promise<LocationDto> {
        const countryList = await locationRepository.getCountries()
        const noLocationInlineBtn = {
            text: 'Я в другом месте',
            callback_data: 'no_location',
        }
        await ctx.reply('В какой стране ты сейчас находишься?', {
            reply_markup: {
                inline_keyboard: [
                    [
                        ...countryList.map(country => ({
                            text: country.name,
                            callback_data: country.id,
                        })),
                        noLocationInlineBtn,
                    ],
                ],
            },
        })
        const location = new LocationDto()
        const answerCountry = await this.conversation.waitFor(
            'callback_query:data',
        )
        const countryId = answerCountry.callbackQuery.data
        if (countryId === 'no_location') {
            return location
        }
        const availableCites = await locationRepository.getCitiesByCountryId(
            countryId,
        )
        if (availableCites) {
            await ctx.reply('В каком городе ты сейчас?', {
                reply_markup: {
                    inline_keyboard: [
                        [
                            ...availableCites.map(city => ({
                                text: city.name,
                                callback_data: city.id,
                            })),
                            noLocationInlineBtn,
                        ],
                    ],
                },
            })
            const answerCityId = await this.conversation.waitFor(
                'callback_query:data',
            )
            const cityId = answerCityId.callbackQuery.data
            if (cityId === 'no_location') {
                return location
            }
            location.city = cityId
        }
        return location
    }

    private async getBirthday(ctx: MyContext): Promise<Date> {
        await ctx.reply(
            '🎂Укажи свою дату рождения\n' + 'В формате: ДД.ММ.ГГГГ',
        )
        const answer = await this.conversation.form.text()
        const pattern = /^(\d{2})\.(\d{2})\.(\d{4})$/
        const dt = Date.parse(answer.replace(pattern, '$3-$2-$1'))
        return answer.match(pattern) && !isNaN(dt)
            ? new Date(dt)
            : await this.getBirthday(ctx)
    }
}
Footer
© 2022 GitHub, Inc.
Footer navigation
Terms
Privacy
Security
Status
Doc
